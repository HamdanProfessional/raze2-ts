import { Graphics } from "pixi.js";
import { Sound } from "../audio/Sounds";
import { objectiveColor, teamName } from "../ui/raze2/palette";

/**
 * CTF and Domination objective controller (Raze 2 modes). Ticked once per frame
 * by GameScreen while a match is live. Reads the flag / control-point nodes the
 * Arena extracted from the Raze 2 map and drives the team objective score
 * (`game.teamScore`), which the HUD shows and GameScreen's score cap ends on.
 *
 * CTF (NodeCtfFlag): a unit takes the ENEMY flag by touching its stand, and
 * scores a capture by carrying it back to their OWN stand. The flag returns
 * home if the carrier dies. Team score = captures.
 *
 * Domination (NodeHoldpoint): touching a control point you don't own claims it
 * for your team after a short contest. Every few seconds each owned point adds
 * one to its team's score.
 */

// Objective tints come from the shared Raze 2 ramp. This file used to carry its
// own {1: red, 2: blue} table, which is backwards twice over: Raze 2 has no red
// team at all, and the local player is always team 1 — so your own flag and
// captured points rendered enemy-red while the enemy's rendered friendly-blue.
const CTF_TOUCH = 46; // flag stand touch radius (world px)
const DOM_TOUCH = 62; // control-point capture radius
const DOM_CAPTURE = 30; // frames of uncontested presence to flip a point (~1s)
const DOM_TICK = 90; // frames between domination score ticks (~3s @ 30fps)
const CHEST = 30; // touch tests are chest-height, matching the pickup logic

interface UnitLike {
  x: number;
  y: number;
  team: number;
  human: boolean;
  status: { dead: boolean };
  hasFlag: Flag | null;
  /** True when this unit's rig has the back slot and is wearing the flag
   *  itself, so nothing needs to be drawn for it here. */
  wearsBackSlot?: boolean;
  /** Standing on a control point this unit's team does not own. Set by
   *  `tickDom`; read by the kill-bonus dispatch. */
  capturing?: boolean;
}

interface Flag {
  x: number;
  y: number;
  team: number;
  carrier: UnitLike | null;
}

interface Point {
  x: number;
  y: number;
  owner: number;
  progress: number; // 0..DOM_CAPTURE while a challenger contests
  by: number; // team currently contesting
}

export class Objectives {
  readonly view = new Graphics();
  readonly mode: "ctf" | "dom";
  readonly active: boolean;
  private game: any;
  private flags: Flag[] = [];
  private points: Point[] = [];
  private domTimer = 0;

  constructor(game: any, mode: "ctf" | "dom") {
    this.game = game;
    this.mode = mode;
    const arena = game.arena;
    if (mode === "ctf") {
      this.flags = (arena.ctfNodes ?? []).map((n: any) => ({ x: n.x, y: n.y, team: n.team, carrier: null }));
      this.active = this.flags.length >= 2;
    } else {
      this.points = (arena.holdNodes ?? []).map((n: any) => ({ x: n.x, y: n.y, owner: 0, progress: 0, by: 0 }));
      this.active = this.points.length >= 1;
    }
    arena.view.addChild(this.view);
  }

  private liveUnits(): UnitLike[] {
    return (this.game.units as UnitLike[]).filter((u) => !u.status.dead);
  }

  private near(u: UnitLike, x: number, y: number, r: number): boolean {
    const dx = u.x - x;
    const dy = u.y - CHEST - y;
    return dx * dx + dy * dy <= r * r;
  }

  enterFrame(): void {
    if (!this.active) return;
    if (this.mode === "ctf") this.tickCtf();
    else this.tickDom();
    this.draw();
  }

  private tickCtf(): void {
    // Return any flag whose carrier has died.
    for (const f of this.flags) {
      if (f.carrier && f.carrier.status.dead) {
        // `Unit.as:331` — the flag snapping home is drawn where the carrier
        // fell, in that flag's own colour, not at the stand it returns to. It
        // is the cue that tells the killer the return actually happened.
        this.game.addEffect(f.carrier.x, f.carrier.y - 50, `flagReset${f.team}`);
        f.carrier.hasFlag = null;
        f.carrier = null;
      }
    }
    for (const u of this.liveUnits()) {
      for (const f of this.flags) {
        if (f.team !== u.team) {
          // Enemy flag: take it if it's home and we aren't already carrying one.
          if (!f.carrier && !u.hasFlag && this.near(u, f.x, f.y, CTF_TOUCH)) {
            f.carrier = u;
            u.hasFlag = f;
            Sound.playSynthAt?.("whoosh", u.x, u.y, 0.5, 700);
            this.game.hud?.addMessage?.(`${u.human ? "You" : "Enemy"} took the flag!`, objectiveColor(f.team === 1 ? 2 : 1));
          }
        } else if (u.hasFlag && this.near(u, f.x, f.y, CTF_TOUCH)) {
          // Own stand while carrying the enemy flag → capture.
          const carried = u.hasFlag;
          carried.carrier = null;
          u.hasFlag = null;
          this.game.teamScore[u.team] = (this.game.teamScore[u.team] ?? 0) + 1;
          Sound.play?.("Medal");
          this.game.hud?.addMessage?.(u.human ? "Flag captured!" : "Enemy captured the flag!", objectiveColor(u.team));
        }
      }
    }
  }

  private tickDom(): void {
    // `Unit.capturing` is read by the kill-bonus dispatch ("Defender!" for
    // killing a unit mid-capture, and its mirror for scoring one while you are
    // taking a point yourself), so it is recomputed from scratch each tick.
    for (const u of this.liveUnits()) u.capturing = false;
    for (const p of this.points) {
      // Who is standing on the point?
      let t1 = false;
      let t2 = false;
      for (const u of this.liveUnits()) {
        if (!this.near(u, p.x, p.y, DOM_TOUCH)) continue;
        if (p.owner !== u.team) u.capturing = true;
        if (u.team === 1) t1 = true;
        else if (u.team === 2) t2 = true;
      }
      const sole = t1 && !t2 ? 1 : t2 && !t1 ? 2 : 0;
      if (sole && sole !== p.owner) {
        if (p.by !== sole) {
          p.by = sole;
          p.progress = 0;
        }
        if (++p.progress >= DOM_CAPTURE) {
          p.owner = sole;
          p.progress = 0;
          p.by = 0;
          this.game.hud?.addMessage?.(`${teamName(sole).toUpperCase()} captured a point!`, objectiveColor(sole));
        }
      } else {
        // Contested or empty: the challenge decays.
        p.progress = Math.max(0, p.progress - 1);
        if (p.progress === 0) p.by = 0;
      }
    }
    // Periodic scoring: each owned point adds one to its team.
    if (++this.domTimer >= DOM_TICK) {
      this.domTimer = 0;
      for (const p of this.points) {
        if (p.owner) this.game.teamScore[p.owner] = (this.game.teamScore[p.owner] ?? 0) + 1;
      }
    }
  }

  /** CTF bot movement goal: own stand while carrying, else the nearest home
   *  enemy flag to go steal. Null if not applicable. */
  ctfGoal(unit: UnitLike): { x: number; y: number } | null {
    if (this.mode !== "ctf" || !this.active) return null;
    if (unit.hasFlag) {
      const own = this.flags.find((f) => f.team === unit.team);
      return own ? { x: own.x, y: own.y } : null;
    }
    let best: Flag | null = null;
    let bd = Infinity;
    for (const f of this.flags) {
      if (f.team === unit.team || f.carrier) continue;
      const d = (f.x - unit.x) ** 2 + (f.y - unit.y) ** 2;
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    return best ? { x: best.x, y: best.y } : null;
  }

  /** Domination bot goal: nearest point the team doesn't own (own points are
   *  deprioritised so bots spread out to contest rather than camp). */
  domGoal(unit: UnitLike): { x: number; y: number } | null {
    if (this.mode !== "dom" || !this.active) return null;
    let best: Point | null = null;
    let bd = Infinity;
    for (const p of this.points) {
      const d = (p.x - unit.x) ** 2 + (p.y - unit.y) ** 2;
      const weight = p.owner === unit.team ? d * 4 : d;
      if (weight < bd) {
        bd = weight;
        best = p;
      }
    }
    return best ? { x: best.x, y: best.y } : null;
  }

  private draw(): void {
    const g = this.view;
    g.clear();
    if (this.mode === "ctf") {
      for (const f of this.flags) {
        const col = objectiveColor(f.team);
        // Base stand.
        g.rect(f.x - 3, f.y - 54, 6, 54).fill({ color: 0x2a3038 });
        g.circle(f.x, f.y, 6).fill({ color: col, alpha: 0.5 });
        // Flag cloth at the pole top when the flag is home.
        if (!f.carrier) {
          g.moveTo(f.x + 3, f.y - 54).lineTo(f.x + 30, f.y - 46).lineTo(f.x + 3, f.y - 38).fill({ color: col });
        }
      }
      // A carrier normally *wears* the flag: Raze 2 puts it on the character's
      // back slot (`NodeCtfFlag.capture` → `MC.body.ability.gotoAndStop("flag"
      // + team)`), which the unit rig renders — see Unit.updateAbilitySlot.
      // Only the rigs without that slot (the Raze 1 layered/baked bodies, which
      // have no back attachment) still need a marker, or their carrier would be
      // holding an invisible flag.
      for (const f of this.flags) {
        const u = f.carrier;
        if (!u || u.wearsBackSlot) continue;
        g.moveTo(u.x, u.y - 96).lineTo(u.x + 22, u.y - 90).lineTo(u.x, u.y - 84).fill({ color: objectiveColor(f.team) });
        g.rect(u.x - 1, u.y - 96, 2, 30).fill({ color: 0x2a3038 });
      }
    } else {
      for (const p of this.points) {
        const col = objectiveColor(p.owner);
        g.circle(p.x, p.y - 6, 18).stroke({ color: col, width: 3, alpha: 0.9 });
        g.circle(p.x, p.y - 6, 18).fill({ color: col, alpha: 0.18 });
        // Capture progress ring while contested.
        if (p.progress > 0) {
          const frac = p.progress / DOM_CAPTURE;
          g.circle(p.x, p.y - 6, 22).stroke({ color: objectiveColor(p.by), width: 3, alpha: 0.4 + frac * 0.6 });
        }
        // A little mast so the point reads as an objective.
        g.rect(p.x - 2, p.y - 60, 4, 54).fill({ color: 0x2a3038 });
        g.rect(p.x + 2, p.y - 60, 16 * (p.owner ? 1 : 0.5), 10).fill({ color: col, alpha: p.owner ? 1 : 0.5 });
      }
    }
  }
}
