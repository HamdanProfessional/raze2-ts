import { Container, Matrix, Sprite } from "pixi.js";
import { PartArt } from "../assets/PartArt";
import { HeadArt } from "../assets/HeadArt";

/**
 * Standalone layered character built from the SWF part rig — the same assembly
 * Unit uses in-game, packaged for menus (the customize preview). Given a costume
 * (head/body/legs) and a render state + frame, it welds the costumed parts plus
 * the separate head so every customization choice shows live.
 */
export class PartFigure {
  readonly view = new Container();
  private partsC = new Container();
  private head = new Sprite();
  private sprites = new Map<number, Sprite>();
  private headId = -1;

  constructor() {
    this.partsC.sortableChildren = true;
    this.view.addChild(this.partsC);
    const piv = HeadArt.pivot();
    this.head.anchor.set(piv.px, piv.py);
    this.view.addChild(this.head);
  }

  static get ready(): boolean {
    return PartArt.loaded;
  }

  frameCount(state: string): number {
    return PartArt.frameCount(state);
  }

  /** Weld one frame. `frame` is 0-based; `scale` scales the whole figure. */
  update(
    costume: { head: number; body: number; legs: number },
    state: string,
    frame: number,
    scale: number,
    facing = 1,
  ): void {
    const rootY = PartArt.rig.rootY;
    const pc = this.partsC;
    pc.position.set(0, rootY * scale);
    pc.scale.set(scale * facing, scale);
    const placements = PartArt.frame(state, frame);
    const used = new Set<number>();
    for (const p of placements) {
      used.add(p.d);
      let sp = this.sprites.get(p.d);
      if (!sp) {
        sp = new Sprite();
        this.sprites.set(p.d, sp);
        pc.addChild(sp);
      }
      sp.zIndex = p.d;
      const piv = PartArt.pivot(p.cid);
      sp.anchor.set(piv.px, piv.py);
      const cn = PartArt.isBodyCostume(p.cid) ? costume.body : costume.legs;
      const tex = PartArt.getTexture(p.cid, cn);
      if (tex) sp.texture = tex;
      sp.visible = !!tex;
      const m = p.m;
      sp.setFromMatrix(new Matrix(m[0], m[2], m[1], m[3], m[4], m[5]));
    }
    for (const [d, sp] of this.sprites) if (!used.has(d)) sp.visible = false;

    // Head layer.
    if (HeadArt.loaded) {
      if (this.headId !== costume.head) {
        const t = HeadArt.getTexture(costume.head);
        if (t) this.head.texture = t;
        this.headId = costume.head;
      }
      const neck = HeadArt.neck(state, frame + 1);
      this.head.x = neck[0] * scale * facing;
      this.head.y = (rootY + neck[1]) * scale;
      this.head.scale.set(scale * facing, scale);
      this.head.visible = true;
    } else {
      this.head.visible = false;
    }
  }
}
