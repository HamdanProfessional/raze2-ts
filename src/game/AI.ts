import { Unit } from "./Unit";
import { K } from "../core/K";
import { UT } from "../core/UT";
import { SD } from "../state/SD";
import { GUN_ORDER, WEAPONS } from "./weapons";
import { Personality } from "./Personality";
import type { PersId } from "./Personality";
import { activateAbility, getAbility } from "./Abilities";
import type { GameScreen } from "./GameScreen";

/**
 * Computer-controlled unit. Ported from Raze 2's AI.as (see docs/raze2/09-ai-bots.md).
 *
 * Faithful behaviours from AI.as:
 *  - Difficulty `diff` (0..10) drives the exact `setDiffStats` table: duck/crouch
 *    chances (standNormal/standTarget/standFlag), fire probability (shotChance,
 *    with the guaranteed-fire diff==10 special case) and aim-lerp speed (aimSpeed).
 *  - Non-campaign (arena/skirmish) bots AIM AT THE HUMAN PLAYER by default; the
 *    per-unit `target` only gates *when/whether* they shoot. Genuine per-unit
 *    target aiming is the campaign-only override (AI.as:377-383, §4.1 of the doc).
 *  - Nearest-visible (line-of-sight) enemy target selection.
 *  - Proactive per-ability use with the documented trigger chances (teleport 2%,
 *    cloak 10%, mine 10%, sword/grenade range-gated), respecting energy.
 *  - Opportunistic duck/crouch (holds K.DOWN) via the diff-scaled stand/nostand
 *    timers, plus Domination hold-and-duck on a contested point.
 *  - Waypoint-graph patrol with a bounded-DFS shortest-path CTF route (random
 *    among the shortest N, mirroring pathFind/searchNode) and a wpTimer stuck-
 *    recovery timeout (getClosestWp).
 *
 * Port-specific extensions (NOT present in Raze 2's AI.as), kept intentionally:
 *  - Weapon-range-aware weapon selection (chooseWeapon) — Raze 2 bots never
 *    switch weapons by AI logic.
 *  - Personality chatter (Personality.ts) is a RAZE 1 import (Personality.as);
 *    Raze 2 skirmish bots are silent. It is left in place per the port's design
 *    but flagged here as non-authentic to Raze 2. See §10 of the doc.
 *
 * The port stores difficulty as a continuous `diffMod` (jittered, clamped); it is
 * mapped onto the discrete `diff` 0..10 scale in the constructor so the authentic
 * setDiffStats formulas apply, reserving diff==10 (guaranteed fire) for the top
 * (ego-mode) ceiling and never producing a frozen diff==0 "dummy" in normal play.
 */

const AI_NAMES = [
  "skittles", "chz", "Mike", "SlapHappy", "xRagex", "UNKNOWN", "Prime", "epic",
  "erix", "OwnU", "Jojo", "Hitman", "Shottie", "twK", "Grey_Area", "Dragon",
  "n00b", "D1g1t4l", "Jumpa", "Pinky", "Boo", "SunRunner", "Hot_Feet", "Sn1p3r",
  "Drake",
];
const AI_TAGS = ["", "", "", "", "(DA)", "[KoS]", "[NBK]", "ks.", "[HoG]", "via."];

/** Local copies of Unit.ts's generic chatter lines, used only to recognise
 * (and replace with a personality line) calls the base class makes to
 * `say()` on spawn/kill — see the `say()` override below. Keeping Unit.ts
 * untouched means these have to be duplicated rather than imported.
 * NOTE: chatter itself is a Raze 1-derived feature, not authentic to Raze 2. */
const BASE_SPAWN_LINES = ["Here we go!", "Ready!", "Back in!", "Let's do this."];
const BASE_KILL_LINES = ["Got him!", "Take that!", "Boom!", "Too easy.", "Next!"];

/** Range-unit -> pixel conversion for weapons.ts' AI_minRange/AI_maxRange,
 * which are small abstract numbers (0-80ish), not arena pixels. */
const RANGE_PX = 6;

/** Melee reach for the katana ability (Abilities.ts SWORD_RANGE), in px — used as
 * the AI's sword trigger gate (AI.as: dist < gunOb["sword"].range * 10). */
const SWORD_REACH = 90;
/** Minimum distance before a bot will lob a grenade, so it doesn't splash itself
 * (AI.as reuses the sword stat block's `splash` as this gate). */
const GRENADE_MIN = 160;

/** Abilities a Raze 2 bot actually uses proactively (AI.as never rolls dice for
 * static/heal/ammo — those bots are silently passive on their ability). */
const BOT_ABILITIES = ["cloak", "sword", "mine", "grenade", "teleport"];

/** Fraction of its weapon's reach within which a bot will notice an enemy.
 * Acquisition otherwise runs at the full `checkUnitHit` range, so a bot locks
 * on the instant anyone clears line of sight anywhere in the arena. */
const DETECT_RANGE = 0.7;

/** `stand` value a scripted escort parks on at its station (AI.as's 999999):
 *  effectively forever, until the script's `wait(0)` releases it. */
const HOLD_STATION = 999999;

export class AI extends Unit {
  private target: any = null;
  private targAimX: number;
  private targAimY: number;
  private waitCounter = 0;
  private setGun: string;
  private nextNode: any = null;
  /** Objective movement goal (CTF flag / Domination point) when in those modes. */
  private goal: { x: number; y: number } | null = null;

  // --- authentic diff (0..10) scaling, derived in setDiffStats() -------------
  diff = 5;
  private diffRev = 5;
  private standNormal = 0;
  private standTarget = 0;
  private standFlag = 0;
  private shotChance = 1;
  private aimSpeed = 0.045;

  // --- duck/crouch stand-timers (AI.as stand/duck/nostand) -------------------
  /** Frames remaining in a committed stand pose. */
  private stand = 0;
  /** Whether the current stand pose is a duck (holds K.DOWN). */
  private duckPose = false;
  /** Blackout window before another stand roll can fire. */
  private nostand = 0;

  // --- CTF routing + stuck recovery ------------------------------------------
  /** Waypoint-name queue for a computed CTF route (empty = random walk). */
  private ctfPath: string[] = [];
  /** Cooldown before recomputing a CTF route. */
  private pathTimer = 0;
  /** Waypoint-name queue toward the station a scripted escort was sent to. */
  private speakPath: string[] = [];
  /** Name of the last waypoint actually reached — the route's true origin. */
  private atNode = "";
  /** Frames since the last waypoint arrival; forces a resync at 120 (4s). */
  private wpTimer = 0;

  /** Frames until the next target re-acquisition + aim-wobble refresh. */
  private reactionTimer = 0;
  /** Current aim inaccuracy offset, refreshed every reaction tick. */
  private aimOffsetX = 0;
  private aimOffsetY = 0;
  /** Cooldown between opportunistic dodge-hops during combat. */
  private dodgeTimer = 0;
  /** Guards against spamming the low-health chatter every frame. */
  private lowHealthWarned = false;

  constructor(game: GameScreen, team: number, extra: any) {
    const pers = extra?.pers ?? Personality.pick();
    super(game, false, team, { ...extra, pers });
    this.pers = pers;
    this.targAimX = this.x;
    this.targAimY = this.y;

    if (SD.matchSettings.campaign) {
      this.diffMod = (extra.diff ?? 1) + (Math.random() * 0.6 - 0.3);
      this._name = extra.name ?? "Enemy";
    } else {
      this.diffMod = (SD.matchSettings.diff ?? 1) + (Math.random() * 0.6 - 0.3);
      const base = AI_NAMES[Math.floor(Math.random() * AI_NAMES.length)];
      this._name = AI_TAGS[Math.floor(Math.random() * AI_TAGS.length)] + base;
    }
    // Ego mode lifts the usual skill ceiling so the top difficulty actually
    // reads as a step above Hard rather than clamping back down to it.
    const ceiling = SD.matchSettings.egoMode ? 3 : 2;
    this.diffMod = Math.max(0.5, Math.min(ceiling, this.diffMod));

    // Map the port's continuous diffMod ([0.5..3]) onto the authentic 0..10
    // `diff` scale. We map to 1..10 (never a frozen diff==0 "dummy" in normal
    // play) with diffMod 3 (ego ceiling) -> diff 10 (guaranteed fire).
    this.diff = Math.max(1, Math.min(10, Math.round(1 + ((this.diffMod - 0.5) / 2.5) * 9)));
    this.setDiffStats();

    // Raze 2 bots carry a random ability (MatchSettings.addBot). The port's bot
    // creation doesn't always supply one, so assign a used-by-AI ability here
    // when none was provided (campaign enemies keep whatever they were given).
    if (!SD.matchSettings.campaign && (!this.ability || this.ability.id === "none")) {
      this.ability = getAbility(BOT_ABILITIES[Math.floor(Math.random() * BOT_ABILITIES.length)]);
    }

    this.setName(this._name);
    this.setGun = this.randomOwnGun();
    this.setCostume();
  }

  /** setDiffStats() (AI.as:85-97): derive all difficulty knobs from `diff`. */
  private setDiffStats(): void {
    const diff = this.diff;
    this.diffRev = 10 - diff;
    this.standNormal = 0.01 * (this.diffRev * 0.3);
    this.standTarget = 0.03 * (this.diffRev * 0.3);
    this.standFlag = 0.005 * (this.diffRev * 0.3);
    this.shotChance = diff === 10 ? 1000 : diff * 0.29 + 0.1;
    // aimSpeed table: 0.030 @ diff0, 0.045 @ diff5, 0.060 @ diff10. (The doc's
    // prose "diff*0.1" is a typo; the authoritative table matches diff*0.01.)
    this.aimSpeed = 0.3 * (diff * 0.01 + 0.1);
  }

  /** Replace the base class's generic chatter with a personality line for
   * the same event, whichever unit instance triggers it (e.g. Unit.killGuy
   * calls `killer.say(...)` on the attacker, which may be this bot).
   * NOTE: chatter is a Raze 1 import, not authentic to Raze 2 (§10 of the doc). */
  override say(text: string): void {
    if (BASE_KILL_LINES.includes(text)) {
      super.say(Personality.line(this.pers, "kill"));
    } else if (BASE_SPAWN_LINES.includes(text)) {
      super.say(Personality.line(this.pers, "spawn"));
    } else {
      super.say(text);
    }
  }

  override respawn(): void {
    this.lowHealthWarned = false;
    this.stand = 0;
    this.nostand = 0;
    this.duckPose = false;
    this.ctfPath = [];
    this.wpTimer = 0;
    super.respawn();
  }

  override killGuy(info: { attacker?: any; x: number; y: number; headShot?: boolean }): void {
    // Personality death chatter for the unit that just died (self).
    if (Math.random() < 0.35) this.say(Personality.line(this.pers, "death"));
    super.killGuy(info);
  }

  override setSpawnNode(name: string): void {
    const nodes = this.game.arena.wayNodes;
    if (nodes && nodes.length) {
      this.nextNode =
        nodes.find((n: any) => n.name === name) ??
        nodes[Math.floor(Math.random() * nodes.length)];
    } else {
      this.nextNode = { x: this.x, y: this.y, reached: true };
    }
    this.setGun = this.randomOwnGun();
  }

  private nodeByName(name: string): any {
    return this.game.arena.wayNodes?.find((n: any) => n.name === name);
  }

  private pickNextNode(): void {
    const nodes = this.game.arena.wayNodes;
    if (!nodes || !nodes.length) {
      const sp = this.game.arena.spawnNodes;
      const s = sp[Math.floor(Math.random() * sp.length)];
      this.nextNode = { x: s.x, y: s.y, reached: false, connects: [], actions: [] };
      return;
    }
    // A scripted escort walks a route to the station its beat assigned it; the
    // random walk below would only get there by luck.
    if (this.extra.speak && this.atNode !== this.extra.speak) {
      const dest = this.nodeByName(this.extra.speak);
      if (dest) {
        if (this.speakPath[this.speakPath.length - 1] !== this.extra.speak) {
          this.speakPath = this.pathFind(dest.x, dest.y, this.atNode);
        }
        const n = this.nodeByName(this.speakPath.shift() ?? "");
        if (n) {
          this.nextNode = { ...n, reached: false };
          return;
        }
      }
    }

    // Follow a computed CTF route if one is queued (consume one node per arrival).
    if (this.ctfPath.length) {
      const name = this.ctfPath.shift()!;
      const n = this.nodeByName(name);
      if (n) {
        this.nextNode = { ...n, reached: false };
        return;
      }
    }
    // Otherwise random-walk across the connected graph (AI.as random-walk branch).
    if (this.nextNode?.connects?.length) {
      const name = this.nextNode.connects[
        Math.floor(Math.random() * this.nextNode.connects.length)
      ];
      const n = this.nodeByName(name);
      this.nextNode = { ...(n ?? nodes[0]), reached: false };
    } else {
      this.nextNode = { ...nodes[Math.floor(Math.random() * nodes.length)], reached: false };
    }
  }

  /** wpTimer stuck-recovery (AI.as:226-252): resync to the nearest waypoint at
   * roughly the bot's height, breaking permanent stalls after a knock-off. */
  private getClosestWp(): void {
    const nodes = this.game.arena.wayNodes;
    if (!nodes || !nodes.length) return;
    let best: any = null;
    let bestDx = Infinity;
    for (const n of nodes) {
      if (Math.abs(n.y - this.y) > 50) continue;
      const dx = Math.abs(n.x - this.x);
      if (dx < bestDx) {
        bestDx = dx;
        best = n;
      }
    }
    // Resyncing means the bot is not where its route thinks it is, so any queued
    // route is void and has to be replanned from wherever it actually landed.
    this.speakPath = [];
    if (best) {
      this.atNode = best.name;
      this.nextNode = { ...best, reached: false };
    } else {
      this.pickNextNode();
    }
    this.wpTimer = 0;
  }

  /**
   * Bounded-DFS shortest-path CTF route (mirrors AI.as pathFind/searchNode:
   * collect simple paths to the target node, sort by summed distance, pick
   * randomly among the shortest min(5, count) for route variety). The port's
   * waypoint graph is fully connected, so DFS is depth- and budget-capped to
   * stay bounded; returns the node-name queue minus the current node.
   */
  private pathFind(destX: number, destY: number, from?: string): string[] {
    const nodes = this.game.arena.wayNodes;
    if (!nodes || !nodes.length) return [];
    // Nearest graph node to the objective point is the DFS destination.
    let dest: any = nodes[0];
    let bestD = Infinity;
    for (const n of nodes) {
      const d = UT.getDist(n.x, n.y, destX, destY);
      if (d < bestD) {
        bestD = d;
        dest = n;
      }
    }
    const start =
      (from && this.nodeByName(from) && from) ||
      (this.nodeByName(this.nextNode?.name) ? this.nextNode.name : nodes[0].name);
    const results: { path: string[]; dist: number }[] = [];
    let budget = 4000;
    const dfs = (name: string, path: string[], dist: number): void => {
      if (budget <= 0) return;
      budget--;
      if (name === dest.name) {
        results.push({ path: path.slice(), dist });
        return;
      }
      if (path.length >= 6) return; // depth cap for the complete graph
      const node = this.nodeByName(name);
      if (!node) return;
      for (const c of node.connects) {
        if (path.indexOf(c) !== -1) continue; // visited-check (no cycles)
        const cn = this.nodeByName(c);
        if (!cn) continue;
        dfs(c, [...path, c], dist + UT.getDist(node.x, node.y, cn.x, cn.y));
      }
    };
    dfs(start, [start], 0);
    if (!results.length) return [dest.name];
    results.sort((a, b) => a.dist - b.dist);
    const pick = results[UT.irand(0, Math.min(5, results.length) - 1)];
    return pick.path.slice(1); // drop the node we're already standing on
  }

  /** Nearest, same-team-exempt, non-cloaked, currently-visible (LOS) enemy. */
  private acquireTarget(): void {
    this.target = null;
    let nearest = (this.gun.curGun?.maxRange ?? Infinity) * DETECT_RANGE;
    for (const u of this.game.units) {
      if (u === this || u.status.dead) continue;
      if (this.team && u.team === this.team) continue;
      if (u.status.fadeTimer > 0) continue; // cloaked (AI.as skips status.sInvis)
      const d = UT.getDist(this.x, this.y, u.x, u.y);
      if (d < nearest && this.gun.checkUnitHit(u)) {
        nearest = d;
        this.target = u;
      }
    }
  }

  /**
   * A random gun from this bot's OWN rack, for the pre-combat / dry-arsenal
   * fallback. Campaign bots carry a scripted class kit (alien guns, the zombie
   * blood gun, the Commander's boss set), so seeding from the stock `GUN_ORDER`
   * named a weapon they do not own and `selectGun` quietly refused it.
   */
  private randomOwnGun(): string {
    const rack = this.gun?.gunOrder;
    const pool = rack?.length ? rack : GUN_ORDER;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /** Best owned, loaded weapon for the given distance (px), scored by how far
   * outside its AI_minRange/AI_maxRange window the distance falls.
   * (Port extension — Raze 2 bots never switch weapons by AI logic.) */
  private chooseWeapon(distPx: number): string {
    const arsenal = this.gun.arsenal;
    const owned = this.gun.gunOrder.filter((id: string) => {
      const g = arsenal[id];
      return g && (g.curClip > 0 || g.curAmmo > 0 || g.infAmmo || g.oneClip);
    });
    if (!owned.length) return this.setGun;

    const distUnits = distPx / RANGE_PX;
    let best = owned[0];
    let bestScore = Infinity;
    for (const id of owned) {
      const def = WEAPONS[id];
      if (!def) continue;
      const minR = def.AI_minRange ?? 0;
      const maxR = def.AI_maxRange ?? 60;
      let score: number;
      if (distUnits < minR) score = minR - distUnits;
      else if (distUnits > maxR) score = distUnits - maxR;
      else score = 0;
      // Tie-break toward the harder-hitting weapon.
      score -= (def.damage ?? 0) * 0.0001;
      if (score < bestScore) {
        bestScore = score;
        best = id;
      }
    }
    return best;
  }

  EnterFrame(): void {
    if (this.status.dead) return;

    // Parked off-map by the mission script; no brain, no physics, no presence
    // until a cue calls it in (AI.as:322).
    if (this.extra.noSpawn) return;

    // Sandbox "freeze bots" toggle: skip the brain but keep gravity/collision
    // ticking so the bot just stands where it is instead of hanging in the air.
    if ((this.game as any).botsDisabled) {
      this.keys = 0;
      this.gun.endShoot();
      this.moveUnit();
      return;
    }

    // Low-health chatter, fired once per dip below the threshold.
    const hpPer = this.status.getHpPer();
    if (hpPer < 0.3 && !this.lowHealthWarned) {
      this.lowHealthWarned = true;
      if (Math.random() < 0.6) this.say(Personality.line(this.pers, "lowHealth"));
    } else if (hpPer > 0.6) {
      this.lowHealthWarned = false;
    }

    if (!this.nextNode) this.pickNextNode();

    // Reached current waypoint? choose another (and reset the stuck timer).
    if (
      !this.nextNode.reached &&
      UT.getDist(this.nextNode.x, this.nextNode.y, this.x, this.y) < 35 &&
      !this.jumping
    ) {
      this.nextNode.reached = true;
      this.wpTimer = 0;
    }
    // A committed hold (a scripted escort at its station) neither re-routes nor
    // re-fires its arrival cue.
    if (this.nextNode.reached && this.stand < HOLD_STATION) {
      // A scripted escort walks the waypoint chain to the station the mission
      // assigned it and then commits to standing there; the script reassigns
      // `speak` and calls wait(0) to send it on to the next beat.
      const arrived = this.nextNode.name;
      if (arrived) this.atNode = arrived;
      this.pickNextNode();
      if (this.extra.speak && this.extra.speak === arrived) {
        this.stand = HOLD_STATION;
        this.game.tutorial?.escortArrived(this.extra.speak);
      }
    }

    this.keys = 0;

    // Re-acquire the target and refresh aim wobble on a reaction timer instead
    // of every frame: harder bots re-scan sooner and with a tighter wobble.
    if (this.reactionTimer > 0) {
      this.reactionTimer--;
    } else {
      this.acquireTarget();
      this.reactionTimer = Math.round(UT.rand(8, 20) / this.diffMod);
      const inaccuracy = 60 / this.diffMod;
      this.aimOffsetX = UT.rand(-inaccuracy, inaccuracy);
      this.aimOffsetY = UT.rand(-inaccuracy, inaccuracy);
    }
    // A dead target (killed since the last reaction tick) is dropped immediately.
    if (this.target && this.target.status.dead) this.target = null;

    // Objective awareness. Juggernaut: everyone hunts the crown-holder. CTF/Dom:
    // steer toward the flag / control point when not locked in a firefight.
    if (SD.matchSettings.type === "jug") {
      const jug = SD.matchSettings.curJug as any;
      if (jug && jug !== this && !jug.status?.dead && this.gun.checkUnitHit(jug)) this.target = jug;
    }
    const obj = (this.game as any).objectives;
    this.goal = obj?.active
      ? obj.mode === "ctf"
        ? obj.ctfGoal(this)
        : obj.mode === "dom"
          ? obj.domGoal(this)
          : null
      : null;

    // CTF: compute/refresh a bounded-DFS waypoint route toward the objective.
    if (obj?.active && obj.mode === "ctf") {
      if (this.pathTimer > 0) this.pathTimer--;
      if (this.ctfPath.length === 0 && this.pathTimer <= 0 && this.goal) {
        this.ctfPath = this.pathFind(this.goal.x, this.goal.y);
        this.pathTimer = 90; // recompute at most ~every 3s
      }
    } else if (this.ctfPath.length) {
      this.ctfPath = [];
    }

    const dist = this.target
      ? UT.getDist(this.x, this.y, this.target.x, this.target.y)
      : Infinity;

    // Opportunistic duck/crouch + objective hold-and-duck (sets K.DOWN).
    this.updateStance();

    // Proactive ability use (teleport/cloak/mine/sword/grenade).
    this.tryAbility(dist);

    // Movement: a committed stand pose freezes the bot in place (AI.as gates the
    // waypoint walk and combat strafing behind `!stand`).
    if (this.stand > 0) {
      // holding position (K.DOWN already set by updateStance if ducking)
    } else if (this.waitCounter > 0) {
      this.waitCounter--;
    } else if (this.target) {
      this.setGun = this.chooseWeapon(dist);
      this.gun.selectGun(this.setGun);
      this.combatMove(dist);
    } else {
      this.patrol();
    }

    // Aim: non-campaign bots track the human player by default; campaign bots do
    // genuine per-unit target aiming (see §4.1 of the doc / class comment).
    this.aimStep();

    // Fire gate: needs a live target + LOS; diff==0 dummies never shoot. Firing
    // is allowed while crouched (a stand pose only freezes movement, not the gun).
    if (this.game.gameStarted && this.target && this.diff) {
      this.fireStep();
    } else {
      this.gun.endShoot();
    }

    // Stuck recovery: if we've gone 4s without reaching a waypoint (and aren't
    // mid-jump or holding a stand pose), forcibly resync to the nearest node.
    if (this.jumping || this.stand > 0) {
      // don't accrue stuck-time while airborne or deliberately holding
    } else if (++this.wpTimer >= 120) {
      this.getClosestWp();
    }

    this.moveUnit();
  }

  /** Hold this pose for `frames`, blacking out the probabilistic duck for the
   * same span (AI.as `wait`). The mission script calls wait(0) to release a
   * committed hold and let the bot resume walking. */
  wait(frames: number, duck = false): void {
    this.stand = frames;
    this.nostand = frames;
    this.duckPose = duck;
    // Released mid-beat: re-plan now, so a station just reassigned is walked to
    // directly instead of after one more hop of the random walk.
    if (frames === 0) this.pickNextNode();
  }

  /** Duck/crouch decision (AI.as:477-547): objective holds first, then the
   * diff-scaled probabilistic duck; a live stand pose holds K.DOWN when ducking. */
  private updateStance(): void {
    // Domination hold-and-duck: sit on a contested/enemy point and crouch.
    const obj = (this.game as any).objectives;
    if (
      this.stand <= 0 &&
      this.nostand <= 0 &&
      !this.jumping &&
      obj?.active &&
      obj.mode === "dom" &&
      this.goal &&
      UT.getDist(this.x, this.y, this.goal.x, this.goal.y) < 70
    ) {
      this.stand = UT.irand(1, 8) * 30;
      this.duckPose = Math.random() < 0.5;
      this.nostand = 0;
    }

    // General probabilistic duck.
    if (this.stand <= 0 && this.nostand <= 0 && !this.jumping) {
      const p = this.hasFlag ? this.standFlag : this.target ? this.standTarget : this.standNormal;
      if (Math.random() < p) {
        this.stand = Math.round(UT.irand(2, 6) * this.diffRev * 0.1 * 30);
        this.duckPose = Math.random() < 0.5;
        this.nostand = this.stand + Math.round(UT.irand(2, 6) * this.diff * 0.1 * 30);
      }
    }

    if (this.stand > 0) {
      this.stand--;
      if (this.duckPose && !this.jumping) this.keys |= K.DOWN;
    }
    if (this.nostand > 0) this.nostand--;
  }

  /** Proactive ability use with the documented per-ability trigger chances
   * (AI.as:566-597). activateAbility() enforces energy/grounding guards. */
  private tryAbility(dist: number): void {
    if (!this.diff || this.hasFlag) return; // diff==0 & flag-carriers don't ability
    const id = this.ability?.id;
    if (!id || id === "none") return;
    if (!this.status.hasEnergy(this.ability.usedEnergy)) return;

    switch (id) {
      case "teleport":
        if (!this.target && Math.random() < 0.02) activateAbility(this);
        break;
      case "cloak":
        if (!this.target && Math.random() < 0.1) activateAbility(this);
        break;
      case "mine":
        if (!this.target && this.stand <= 0 && this.nostand <= 0 && Math.random() < 0.1) {
          activateAbility(this);
        }
        break;
      case "sword":
        if (this.target && dist < SWORD_REACH) activateAbility(this);
        break;
      case "grenade":
        if (this.target && dist > GRENADE_MIN) activateAbility(this);
        break;
      // static/heal/ammo: Raze 2 bots never trigger these proactively.
    }
  }

  /** Combat movement only (strafe + jumps); aiming and firing are separate. */
  private combatMove(dist: number): void {
    const g = this.target;
    const minR = (this.gun.curGun.AI_minRange ?? 0) * RANGE_PX;
    const maxR = (this.gun.curGun.AI_maxRange ?? 60) * RANGE_PX;
    if (this.hasFlag && this.goal) {
      // Carrying the enemy flag: break contact and run home, shooting on the move.
      this.keys |= this.goal.x > this.x ? K.RIGHT : K.LEFT;
      // (no "goal is above me" hop: the SWF only ever jumps from an action
      // box or a deliberate dodge, never to climb toward a target.)
    } else if (dist > maxR) {
      this.keys |= g.x > this.x ? K.RIGHT : K.LEFT;
    } else if (dist < minR) {
      this.keys |= g.x > this.x ? K.LEFT : K.RIGHT;
    }

    if (!this.jumping) {
      if (g.y < this.y - 40 && Math.random() < 0.05 * this.diffMod) {
        this.doJump(true);
      } else if (this.dodgeTimer <= 0 && Math.random() < 0.01 * this.diffMod) {
        this.doJump(true);
        this.dodgeTimer = 40;
      }
    }
    if (this.dodgeTimer > 0) this.dodgeTimer--;
  }

  /** Fire gate (AI.as:620-632): fire probability scales with the gun's base
   * AI fire rate and `shotChance` (diff), guaranteed at diff==10. */
  private fireStep(): void {
    const g = this.target;
    const canHit = this.gun.checkUnitHit(g);
    // `AI.as:624` doubles a bot's per-frame fire chance while Rapid Fire is up,
    // so a bot that grabs the pickup actually spends it instead of holding a
    // buff the player never sees.
    let shootSpd = (this.gun.curGun.AI_firePerc ?? 0.05) * this.shotChance;
    if (this.status?.rapidTimer > 0) shootSpd *= 2;
    if (canHit && Math.random() < Math.min(1, shootSpd)) {
      this.gun.startShoot();
      if (Math.random() < 0.05) this.say(Personality.line(this.pers, "taunt"));
    } else {
      this.gun.endShoot();
    }
  }

  /**
   * Aim update (`AI.as:365-383`).
   *
   * The player-tracking branch is gated on `extra.aimPlayer` **only** — it is
   * the scripted-escort override, so the instructor keeps his gun on you
   * through the walkthrough. Everything else aims at the unit it actually
   * acquired.
   *
   * This used to read `(!campaign || extra.aimPlayer)`, which turned the
   * override on for every bot in every non-campaign match: they validated the
   * shot against their real target in `fireStep` but aimed along a line to the
   * human, so they fired into walls whenever the player was not in that line.
   * That is the "bots shoot at nothing" behaviour.
   */
  private aimStep(): void {
    const player = this.game.player as any;

    if (this.extra.aimPlayer && player && !player.status?.dead && player !== this) {
      const fx = player.x + this.aimOffsetX;
      const fy = player.y - 45 + this.aimOffsetY;
      this.targAimX += (fx - this.targAimX) * 0.8;
      this.targAimY += (fy - this.targAimY) * 0.8;
    } else if (this.target) {
      const g = this.target;
      const fx = g.x + this.aimOffsetX;
      const fy = g.y - 45 + this.aimOffsetY;
      this.targAimX += (fx - this.targAimX) * this.aimSpeed;
      this.targAimY += (fy - this.targAimY) * this.aimSpeed;
    } else {
      // Idle "look where I'm walking" drift (AI.as:172-174, fixed 0.4/0.3).
      const dir = this.keys & K.LEFT ? -1 : 1;
      this.targAimX += (this.x + dir * 60 - this.targAimX) * 0.4;
      this.targAimY += (this.y - 40 - this.targAimY) * 0.3;
    }
    this.aimX = this.targAimX;
    this.aimY = this.targAimY;
  }

  /**
   * `UT.inBox` (`UT.as:192`): strictly inside, with (x, y) the box's TOP-LEFT.
   * Reproduced exactly — the boundary being exclusive matters for the thin
   * boxes some maps use as a trigger line rather than a volume.
   */
  private static inBoxAt(px: number, py: number,
                         b: { x: number; y: number; w: number; h: number }): boolean {
    return px > b.x && px < b.x + b.w && py > b.y && py < b.y + b.h;
  }

  private patrol(): void {
    // Head for the objective (CTF flag / Domination point) when one is set and
    // no waypoint route is queued; otherwise walk the waypoint graph.
    const n = this.ctfPath.length ? this.nextNode : this.goal ?? this.nextNode;
    if (this.x > n.x + 5) this.keys |= K.LEFT;
    else if (this.x < n.x - 5) this.keys |= K.RIGHT;

    // Authored jump zones on the node we are heading for (`AI.as:598-618`).
    // The level designer placed these to mark exactly where the route goes up,
    // so a bot jumps *here* and nowhere else: `j` starts a jump only from the
    // ground, `d` fires regardless, which is what spends the double jump.
    //
    // There used to be a random 8%-per-frame "the next node is higher, try a
    // jump" rule alongside this, because the port had never extracted the
    // action boxes and bots otherwise could not climb at all. That guess is
    // what made them hop on the spot under a ledge forever — the thing that
    // actually looked broken. With the real zones in the map data it is gone.
    for (const a of n.actions ?? []) {
      if (!AI.inBoxAt(this.x, this.y, a)) continue;
      if (a.action === "j") {
        if (!this.jumping) this.doJump(true);
      } else if (a.action === "d") {
        this.doJump(true);
      }
    }

    // Levels with no authored graph (the Raze 1 maps, whose `wayNodes` is a
    // mesh over spawn points) have no jump zones either, so there the guess is
    // still the only way up and is kept. It is deliberately NOT used where real
    // zones exist — that was the stuck-jumping.
    if (!this.game.arena.authoredWaypoints && n.y < this.y - 20) {
      if (!this.jumping && Math.random() < 0.08) this.doJump(true);
      else if (this.jumping && !this.jumping.dJump && this.jumping.vel > -2) this.doJump(true);
    }

    if (Math.random() < 0.01) this.waitCounter = Math.floor(UT.rand(5, 30));
    if (Math.random() < 0.001) this.say(Personality.line(this.pers, "taunt"));
  }
}
