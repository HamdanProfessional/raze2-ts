// Minimal headless stub of the pixi.js API surface used by the game modules.
// Rendering is a no-op; geometry/transform calls just record nothing.
class Node {
  constructor() {
    this.children = [];
    this.x = 0; this.y = 0; this.rotation = 0; this.alpha = 1; this.visible = true;
    this.scale = { x: 1, y: 1, set(x, y) { this.x = x; this.y = y ?? x; } };
    this.position = { set: (x, y) => { this.x = x; this.y = y; } };
    this.pivot = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y ?? x; } };
    this.anchor = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y ?? x; } };
    // Local drawing extent, accumulated from the geometry calls below so the
    // layout audit (test/layoutcheck.ts) can measure a screen without a
    // renderer. Null until something is drawn.
    this.localBounds = null;
  }
  /** Grow `localBounds` to include the given local-space box. */
  mark(x0, y0, x1, y1) {
    const b = this.localBounds;
    if (!b) this.localBounds = { x0, y0, x1, y1 };
    else {
      b.x0 = Math.min(b.x0, x0); b.y0 = Math.min(b.y0, y0);
      b.x1 = Math.max(b.x1, x1); b.y1 = Math.max(b.y1, y1);
    }
    return this;
  }
  addChild(...c) { this.children.push(...c); return c[0]; }
  addChildAt(c, i = 0) { this.children.splice(i, 0, c); return c; }
  getChildIndex(c) {
    const i = this.children.indexOf(c);
    if (i < 0) throw new Error("child not found");
    return i;
  }
  setChildIndex(c, i) {
    const cur = this.children.indexOf(c);
    if (cur < 0) return;
    this.children.splice(cur, 1);
    this.children.splice(i, 0, c);
  }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
  removeChildren() { const c = this.children; this.children = []; return c; }
  destroy() {}
  clear() { this.localBounds = null; return this; }
  rect(x = 0, y = 0, w = 0, h = 0) { return this.mark(x, y, x + w, y + h); }
  roundRect(x = 0, y = 0, w = 0, h = 0) { return this.mark(x, y, x + w, y + h); }
  circle(x = 0, y = 0, r = 0) { return this.mark(x - r, y - r, x + r, y + r); }
  ellipse(x = 0, y = 0, rw = 0, rh = 0) { return this.mark(x - rw, y - rh, x + rw, y + rh); }
  moveTo(x = 0, y = 0) { return this.mark(x, y, x, y); }
  lineTo(x = 0, y = 0) { return this.mark(x, y, x, y); }
  // The arc is bounded by its control point and end point; marking both is a
  // safe over-estimate for a layout audit.
  arcTo(x1 = 0, y1 = 0, x2 = 0, y2 = 0) {
    return this.mark(Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2));
  }
  closePath() { return this; }
  fill() { return this; }
  stroke() { return this; }
  // EventEmitter surface: interactive UI registers handlers but nothing in a
  // headless run ever dispatches, so these are inert.
  on() { return this; }
  once() { return this; }
  off() { return this; }
  emit() { return false; }
  removeAllListeners() { return this; }
}
export class Container extends Node {}
export class Graphics extends Node {}
export class Texture {}
export class Matrix {
  constructor(a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0) { Object.assign(this, { a, b, c, d, tx, ty }); }
}
export class Sprite extends Node { constructor(t) { super(); this.texture = t; this.tint = 0xffffff; } }
export class Rectangle {
  constructor(x = 0, y = 0, width = 0, height = 0) { Object.assign(this, { x, y, width, height }); }
  contains(px, py) { return px >= this.x && px < this.x + this.width && py >= this.y && py < this.y + this.height; }
}
// Filters are applied to a Node.filters array; headless rendering ignores them.
export class BlurFilter { constructor(o = {}) { Object.assign(this, o); } }
export class Filter { constructor(o = {}) { Object.assign(this, o); } }
export const Assets = { load: async () => new Texture() };
export class Text extends Node {
  constructor(o = {}) { super(); this.text = o.text ?? ""; this.style = o.style ?? {}; }
  /** Longest rendered line, in characters (after naive word wrapping). */
  get lines() {
    const s = this.style ?? {};
    const size = s.fontSize ?? 16;
    const perChar = size * 0.55 + (s.letterSpacing ?? 0);
    const raw = String(this.text).split("\n");
    if (!s.wordWrap || !s.wordWrapWidth) return raw;
    const out = [];
    for (const para of raw) {
      let line = "";
      for (const word of para.split(" ")) {
        const next = line ? `${line} ${word}` : word;
        if (next.length * perChar > s.wordWrapWidth && line) { out.push(line); line = word; }
        else line = next;
      }
      out.push(line);
    }
    return out;
  }
  // Layout code (credits/medal lists) stacks rows by measured height; there is
  // no font engine here, so approximate a line from the style's line height.
  get height() {
    const s = this.style ?? {};
    return this.lines.length * (s.lineHeight || (s.fontSize ?? 16) * 1.2 || 16);
  }
  set height(_v) {}
  /** Approximate advance width; good enough to catch text running off stage. */
  get width() {
    const s = this.style ?? {};
    const size = s.fontSize ?? 16;
    const perChar = size * 0.55 + (s.letterSpacing ?? 0);
    return Math.max(0, ...this.lines.map((l) => l.length * perChar));
  }
  set width(_v) {}
}
// Hud measures wrapped campaign text through this rather than a Text instance.
// Reuse Text's approximate wrapper so both paths agree on where lines break.
export class CanvasTextMetrics {
  static measureText(text, style) {
    return new Text({ text, style });
  }
}
export class NineSliceSprite extends Node { constructor(o = {}) { super(); Object.assign(this, o); } }
export class TextStyle { constructor(o = {}) { Object.assign(this, o); } }
export class Application {
  async init() {} get canvas() { return {}; } get stage() { return new Container(); }
  get ticker() { return { add() {} }; }
}
