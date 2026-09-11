import { Container, Matrix, Sprite } from "pixi.js";
import { MID_CONT_DEPTH, PropArt, type PropDef, type PropPlacement } from "../assets/PropArt";
import { UT } from "../core/UT";

/**
 * The map's authored animated props — the layer the port was missing entirely.
 *
 * In the SWF these are plain MovieClips sitting on the Arena frame, so the
 * tutorial's script drives them with ordinary timeline verbs
 * (`arena.bridge.play()`, `arena.heart.gotoAndPlay("dance")`,
 * `arena["gear" + i].stop()`). {@link PropClip} is just enough MovieClip to
 * honour those calls: a playhead, the frames it halts on, and the frame it
 * loops back to.
 *
 * The split into two containers is not cosmetic. `midCont` — the container
 * `Game.as:152` puts the units, bullets and physics world into — sits at depth
 * 1663 on the Arena timeline, and the tutorial's props straddle it: the bridges,
 * heart and arrow are authored below it (depths 2..189) and the conveyor treads,
 * gears and lights above it (1667..1788). So the player runs *behind* the
 * machinery and *in front of* the bridges, which is exactly how the original
 * reads.
 */

/** Frames a clip advances per logic tick. The SWF runs its timelines at the
 *  same 30fps as the game loop, so this is 1 — named for the reader. */
const FRAMES_PER_TICK = 1;

export class PropClip {
  readonly view = new Container();
  private readonly spr = new Sprite();
  private readonly def: PropDef;

  /** 1-based, like Flash's `currentFrame`. */
  private frame = 1;
  private playing = false;
  /** Where the playhead returns to at the end of the timeline. */
  private loopTo: number;
  private loopEnd: number;

  constructor(
    readonly name: string,
    readonly prop: string,
    def: PropDef,
    place: PropPlacement,
  ) {
    this.def = def;
    [this.loopTo, this.loopEnd] = def.loop ?? [1, def.frames.length];

    // The placement matrix positions the symbol's REGISTRATION POINT, so the
    // transform belongs on the container and the content offset on the sprite
    // inside it. It is applied whole: these placements rotate and mirror (the
    // tutorial's treads are all tilted 22°, the mine's belts are rotated and
    // flipped), and a scale-only read would lay them out flat and wrong.
    this.view.setFromMatrix(
      new Matrix(place.a, place.b, place.c, place.d, place.x, place.y),
    );
    this.spr.scale.set(1 / def.bakeScale);
    // A whitened prop is an alpha mask: the placement's flat colour is the whole
    // point of it, and without a transform of its own it falls back to the
    // colour the art was drawn in.
    if (def.whitened) this.spr.tint = place.tint ?? def.nativeTint ?? 0xffffff;
    else if (place.tint !== undefined) this.spr.tint = place.tint;
    // The placement's alpha is just the initial value of the same property the
    // script writes: `arena.arrow.alpha = 1` overwrites the authored 0 outright
    // rather than scaling it.
    this.view.alpha = place.alpha ?? 1;
    this.view.addChild(this.spr);

    // `Light_Pulse`/`Light_Circle` frame 1 does gotoAndPlay(irand(2, total)),
    // which is what keeps seven copies of one clip visibly out of phase.
    if (def.randStart || def.randLoop) {
      this.frame = UT.irand(this.loopTo, this.loopEnd);
      this.playing = true;
    } else if (!def.stops) {
      this.playing = true;                 // a plain cycling clip just runs
    }
    this.draw();
  }

  play(): void {
    this.playing = true;
  }

  stop(): void {
    this.playing = false;
  }

  gotoAndPlay(where: string | number): void {
    const f = typeof where === "number" ? where : this.def.labels?.[where];
    if (f === undefined) return;
    this.frame = f;
    this.playing = true;
    // A labelled jump re-homes the loop: the heart's frame 21 script is
    // `gotoAndPlay("dance")`, so once it is dancing it cycles 9..21, not 1..8.
    if (typeof where === "string") {
      this.loopTo = f;
      this.loopEnd = this.def.frames.length;
    }
    this.draw();
  }

  gotoAndStop(where: string | number): void {
    this.gotoAndPlay(where);
    this.playing = false;
  }

  /** `arena.arrow.alpha = n` from the walkthrough script. */
  setAlpha(a: number): void {
    this.view.alpha = a;
  }

  advance(): void {
    if (!this.playing) return;
    let f = this.frame + FRAMES_PER_TICK;
    if (f > this.loopEnd) {
      // A clip whose randomiser sits inside its own cycle re-rolls here rather
      // than returning to the top, so the flicker stays irregular.
      f = this.def.randLoop ? UT.irand(this.loopTo, this.loopEnd) : this.loopTo;
    }
    this.frame = f;
    // Flash runs a frame script on ENTERING the frame, so a clip that is parked
    // on a stop can still be restarted by play() — it only halts on the *next*
    // stop it reaches.
    if (this.def.stops?.includes(f)) this.playing = false;
    this.draw();
  }

  private draw(): void {
    const tex = PropArt.frame(this.prop, this.frame);
    const meta = this.def.frames[this.frame - 1];
    if (!tex || !meta) {
      this.spr.visible = false;
      return;
    }
    this.spr.visible = true;
    this.spr.texture = tex;
    this.spr.x = meta.lx;
    this.spr.y = meta.ly;
  }
}

export class MapProps {
  /** Authored below `midCont` — draws behind the units. */
  readonly back = new Container();
  /** Authored above `midCont` — draws in front of the units. */
  readonly front = new Container();

  private clips: PropClip[] = [];
  private byName = new Map<string, PropClip>();

  constructor(mapId: string) {
    for (const place of PropArt.placements(mapId)) {
      const def = PropArt.def(place.prop);
      if (!def) continue;
      const clip = new PropClip(place.name, place.prop, def, place);
      this.clips.push(clip);
      if (place.name) this.byName.set(place.name, clip);
      (place.depth < MID_CONT_DEPTH ? this.back : this.front).addChild(clip.view);
    }
  }

  get count(): number {
    return this.clips.length;
  }

  /** One clip by its authored instance name (`bridge2`, `gear3`, `heart`). */
  get(name: string): PropClip | undefined {
    return this.byName.get(name);
  }

  /** Every clip of one prop kind, for the `gear1..5` / `tread1..8` sweeps. */
  all(prop: string): PropClip[] {
    return this.clips.filter((c) => c.prop === prop);
  }

  enterFrame(): void {
    for (const c of this.clips) c.advance();
  }

  destroy(): void {
    this.back.destroy({ children: true });
    this.front.destroy({ children: true });
    this.clips = [];
    this.byName.clear();
  }
}
