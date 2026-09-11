/**
 * Campaign mission 1 ("Breaking In") — the guided walkthrough.
 *
 * Raze 2 drives the tutorial off a single counter, `player.sEvent`, that is both
 * the step you are on *and* the collision variant the map is staged in. Each
 * step paints its trigger into the wall bitmap: magenta (`tutStep`, walk into
 * it) or purple (`tutWall`, shoot it). Clearing a step bumps the counter and
 * restages the geometry, which simultaneously opens the way on and removes the
 * trigger you just tripped — so nothing can fire twice and nothing needs a
 * per-door script.
 *
 * Alongside it, your escort (J. Rockit, roster slot 1) walks the waypoint chain
 * to whatever station the current beat assigned him, holds there and delivers a
 * line, while the HUD shows the instruction card for the control that step is
 * teaching. Both are just consequences of the counter; this class is the
 * counter plus the eleven cases hung off it.
 *
 * Steps 5 and 11 carry no marker: 5 is the scripted missile (a timer, not a
 * trigger) and 11 is the hand-over — once the counter reaches it the walkthrough
 * is done and the mission's normal deathmatch script takes over.
 */

import { Sound } from "../audio/Sounds";
import { getAbility } from "./Abilities";
import type { AI } from "./AI";
import type { GameScreen } from "./GameScreen";

/** Instruction cards (`Hud.gotoAndStop(...)`), keyed by the station that shows
 *  them. The original draws key diagrams; the strings are its own. */
const CARDS: Record<string, { title: string; body: string[] }> = {
  b: { title: "MOVEMENT", body: ["W A S D  or  Arrow Keys", "Space to Jump"] },
  c: { title: "DOUBLE JUMP", body: ["Jump, then Jump again in air", "Move the mouse to look around"] },
  d: { title: "JUMP PADS", body: ["Jump off jump pads to be", "launched great distances"] },
  ability: {
    title: "ABILITIES",
    body: [
      "F  or  Ctrl  —  when energy is full",
      "Resupply gives you a clip of ammo.",
      "Unlock more in the Armory.",
    ],
  },
  g: { title: "SWITCH WEAPONS", body: ["Q / E  or  Shift / Enter", "1 to 7 to pick one directly"] },
};

/** The escort's scripted lines, verbatim from his `speak_*` frames. */
const LINES: Record<string, string> = {
  b: "Let's go, I don't have much time to explain. The aliens, they've returned. No one knows why...",
  c: "You're the only survivor on the force from last time, so we need you to get back up to speed quickly!",
  follow: "This way, hurry!",
  d: "Hmm, this conveyor belt will be a pain to get across. Jump off this jump pad for a shortcut.",
  e: "Alright now... Oh crap, look at that missile!",
  e2: "Prepare for impact!",
  f: "Looks like you took some damage in that blast. Grab the health over here to heal up.",
  f2: "Now you need some ammo. Go grab that ammo backpack on the left.",
  f3: "Now that you have an ammo pack, use it and shoot the explosive pipe above me to drop the panel.",
  g: "Hmmm, there's no pipes up there, you might need to use something else on this panel...",
};

/** Seconds a walkthrough line holds. Long enough to read while walking. */
const LINE_HOLD = 5;

/** First counter value past the last scripted step — the hand-over. */
const DONE = 11;

/** `SkyFallBig`'s length, and the frame its script ducks the escort on. */
const MISSILE_FRAMES = 238;
const MISSILE_DUCK = 171;

/** The blast's damage (SWF 45, under the port's ×10 HP convention). */
const BOMB_DAMAGE = 450;

export class Tutorial {
  /** `player.sEvent`: the step being played, and the staged wall frame. */
  private step = 1;
  /** Frames elapsed in the missile sequence; 0 when it is not running. */
  private missile = 0;
  /** Whether the player was standing in a trigger volume last tick, so a step
   *  fires on entry rather than every frame you spend inside it. */
  private onStep = false;
  /** The opening card is put up on the first live tick, not at construction. */
  private opened = false;

  constructor(private game: GameScreen) {}

  /** True while the walkthrough still owns the mission (gates the match script). */
  get running(): boolean {
    return this.step < DONE;
  }

  private get escort(): AI | undefined {
    return this.game.units[1] as AI | undefined;
  }

  enterFrame(): void {
    if (!this.opened) {
      this.opened = true;
      this.game.hud.setTutCard(CARDS[this.escort?.extra?.speak] ?? null);
    }
    if (this.missile > 0) this.tickMissile();
    if (!this.running) return;

    // The trigger volumes are painted into the special layer, sometimes over
    // solid floor and sometimes over walk-through air; sampling the surface
    // under the player's feet finds both, since that read ignores solidity.
    const inside = this.game.player.surfaceMods?.type === "tutStep";
    if (inside && !this.onStep) this.runStep();
    this.onStep = inside;
  }

  /** The escort reached the station his beat sent him to. */
  escortArrived(node: string): void {
    if (LINES[node]) this.say(LINES[node]);
    this.game.hud.setTutCard(CARDS[node] ?? null);
  }

  /** A shot landed on a `tutWall` panel. Steps 8 and 9 are gated on this. */
  shotWall(slot: number | undefined): void {
    const props = this.game.arena.props;
    if (this.step === 8) {
      // The explosive pipe: anything sets it off, and it drops the panel below.
      this.game.hud.setTutCard(null);
      Sound.play("R2_rocketExplode");
      this.game.shakeCamera(10);
      // The nav arrow has done its job; both remaining bridges take their first
      // step of collapse (each `play()` runs on to that clip's next stop).
      props?.get("arrow")?.setAlpha(0);
      props?.get("bridge2")?.play();
      props?.get("bridge3")?.play();
      this.send("g");
      this.advance();
    } else if (this.step === 9 && slot === 2) {
      // The panel itself only yields to a shotgun-class weapon — the point of
      // the beat is that you switch to the right tool.
      this.game.hud.setTutCard(null);
      props?.get("bridge3")?.play();
      this.send("i", LINES.follow);
      this.advance();
    }
  }

  /** Run the case for the step whose trigger was just entered. */
  private runStep(): void {
    // Every step clears the card first, as the original's `gotoAndStop("hud")`.
    this.game.hud.setTutCard(null);

    switch (this.step) {
      case 1:
        this.send("c");
        break;
      case 2:
        this.send("d", LINES.follow);
        break;
      case 3:
        this.send("e");
        // `Unit.as` case 2: the walkway you just crossed gives way behind you.
        // This is the bridge's FIRST collapse — the missile later plays it on to
        // its second. Without it the whole thing dropped at once on the strike,
        // which reads as the missile felling a pipe you were nowhere near.
        this.game.arena.props?.get("bridge")?.play();
        this.game.shakeCamera(4, 2);
        break;
      case 4:
        // The missile is overhead two steps before it lands: the sky carries it
        // while the escort is still talking (`Unit.as` case 3).
        this.game.arena.setSky("tut_missile");
        this.missile = 1;
        break;
      case 6:
        this.say(LINES.f2);
        break;
      case 7:
        this.grantResupply();
        // The nav arrow is authored at alpha 0 and only turned on here
        // (`Unit.as:876`), for the walk down to the explosive pipe — step 8
        // switches it straight back off.
        this.game.arena.props?.get("arrow")?.setAlpha(1);
        this.say(LINES.f3);
        this.game.hud.setTutCard(CARDS.ability);
        break;
      case 10:
        // Out into the arena: the walkthrough is over and the deathmatch script
        // starts its clock from zero.
        this.game.startCampScript();
        break;
    }

    this.advance();
  }

  /** The scripted missile: it lands on a timer once step 4 is cleared. */
  private tickMissile(): void {
    this.missile++;
    if (this.missile === MISSILE_DUCK) {
      this.say(LINES.e2);
      this.escort?.wait(999999, true);
    }
    if (this.missile < MISSILE_FRAMES) return;
    this.missile = 0;
    this.bombHit();
  }

  /** `Game.tutBombHit`: the blast that clears step 5 and hurts you for it.
   *
   *  This is the beat the whole map is built around: two bridges give way, the
   *  factory's conveyor dies, the sky turns, and the heart on the far wall goes
   *  into its panic dance. */
  private bombHit(): void {
    Sound.play("R2_rocketExplode");
    Sound.play("R2_Headshot1");
    Sound.play("R2_Static");
    Sound.setMusic("R2_Rose");
    this.game.shakeCamera(15);

    const props = this.game.arena.props;
    props?.get("bridge")?.play();
    props?.get("bridge2")?.play();
    props?.get("heart")?.gotoAndPlay("dance");
    // The machinery is running until the strike knocks the power out; after
    // this the gears and belts stay dead for the rest of the mission.
    for (const g of props?.all("gear") ?? []) g.stop();
    for (const t of props?.all("tread") ?? []) t.stop();
    // The sky turns over and `whiteFlash_139` — a one-second white-out authored
    // onto that very sky frame — covers the cut.
    this.game.arena.setSky("tut_attack");
    this.game.flashWhite();

    this.game.player.status.doDamage(BOMB_DAMAGE, {
      x: this.game.player.x,
      y: this.game.player.y,
    });
    this.send("f");
    this.advance();
  }

  /** Step 7's reward: the Resupply ability, which is where your ammo comes from
   *  for the two shooting steps that follow. */
  private grantResupply(): void {
    const p = this.game.player;
    p.ability = getAbility("ammo");
    p.status.abilityCharge = p.ability.recharge;
    p.status.enCur = p.status.enMax;
    Sound.play("R2_Equip");
  }

  /**
   * Send the escort on to `node`, releasing his hold, optionally with a line
   * spoken as he sets off.
   *
   * The card for the destination goes up now rather than when he gets there
   * (the original's timing): it names the control you need to *follow* him with
   * — the double jump card is useless once he is already standing above you.
   */
  private send(node: string, line?: string): void {
    const e = this.escort;
    if (e) {
      e.extra.speak = node;
      e.wait(0);
    }
    this.game.hud.setTutCard(CARDS[node] ?? null);
    if (line) this.say(line);
  }

  private say(text: string): void {
    const e = this.escort;
    this.game.hud.setCampMsg(e?.extra?.skin ?? null, e?._name ?? null, text, LINE_HOLD);
  }

  /** Clear the current step: bump the counter and restage the collision layer
   *  to match, which is what actually opens the way on. */
  private advance(): void {
    this.step++;
    this.game.arena.changeWallFrame(this.step);
  }
}
