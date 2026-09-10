import { Net } from "./Net";

/**
 * In-match network coordinator (Phase 2 of online multiplayer).
 *
 * Model: HOST-AUTHORITATIVE. The room host runs the full GameScreen simulation
 * for every unit — its own player from local input, each remote human from that
 * peer's transmitted input, and the bots from the AI. Every tick the host
 * broadcasts a snapshot of all units (+ discrete kill events); peers do NOT
 * simulate — they render units from the snapshot (light smoothing) and stream
 * their own input up to the host.
 *
 * Wire format rides the server's opaque `relay` channel (see protocol.ts):
 *   peer -> host : { k:"in", ...NetInput }         (addressed to the host only)
 *   host -> all  : { k:"snap", u:UnitNetState[], e:KillEvent[] }
 *   host -> all  : { k:"roster", u:RosterEntry[] } (identity, sent periodically)
 */

export type NetRole = "off" | "host" | "client";

/** Everything a peer needs to render one unit for a frame. */
export interface UnitNetState {
  id: string;
  x: number;
  y: number;
  /** facing: +1 / -1 */
  f: number;
  /** aim rotation, degrees (world-invariant). */
  a: number;
  /** crouch 0/1 */
  c: number;
  /** airborne 0/1 */
  air: number;
  /** horizontal walk velocity (drives run/idle anim). */
  vel: number;
  /** vertical velocity (drives jump/fall anim). */
  vy: number;
  /** held weapon id */
  g: string;
  /** clip / reserve ammo (for the owner's HUD) */
  clip: number;
  ammo: number;
  /** shield / hp current */
  sh: number;
  hp: number;
  /** dead 0/1 */
  d: number;
  /** juggernaut 0/1 */
  j: number;
  /** firing this tick 0/1 (peers spawn muzzle/tracer on the rising edge). */
  fire: number;
  /** kills / deaths (for the peers' scoreboard). */
  ki: number;
  de: number;
}

/** Identity that doesn't change tick-to-tick, sent on the roster channel. */
export interface RosterEntry {
  id: string;
  name: string;
  team: number;
  /** costume preset (cosmetic). */
  cs: number;
  /** human 0/1 (bots are 0). */
  hu: number;
}

/** One peer's control state for a tick. */
export interface NetInput {
  keys: number;
  /** aim rotation degrees, from the peer's own shoulder→cursor. */
  aim: number;
  fire: number;
  /** jump edge (pressed this tick) 0/1 */
  jump: number;
  /** weapon id to select, or "" */
  gun: string;
  /** reload edge 0/1 */
  reload: number;
  /** -1 prev, +1 next, 0 none */
  cycle: number;
}

export interface KillEvent {
  atk: string;
  vic: string;
  gun: string;
  hs: number;
  atkTeam: number;
  vicTeam: number;
}

class NetGameC {
  role: NetRole = "off";
  selfId = "";
  hostId = "";
  seed = 0;

  /** host: latest input received per peer id. */
  private inputs = new Map<string, NetInput>();
  /** client: most recent + previous snapshot (for interpolation). */
  latest: { u: UnitNetState[]; e?: KillEvent[] } | null = null;
  prev: { u: UnitNetState[] } | null = null;
  /** client: latest roster, applied when units are created. */
  roster = new Map<string, RosterEntry>();
  /** client: kill events not yet consumed by the HUD. */
  pendingKills: KillEvent[] = [];

  private unsub: (() => void) | null = null;

  get isHost(): boolean {
    return this.role === "host";
  }
  get isClient(): boolean {
    return this.role === "client";
  }
  get active(): boolean {
    return this.role !== "off";
  }

  begin(role: NetRole, selfId: string, hostId: string, seed: number): void {
    this.role = role;
    this.selfId = selfId;
    this.hostId = hostId;
    this.seed = seed;
    this.inputs.clear();
    this.latest = null;
    this.prev = null;
    this.roster.clear();
    this.pendingKills.length = 0;
    this.unsub?.();
    this.unsub = Net.on("relay", (r) => this.onRelay(r.from, r.data));
  }

  end(): void {
    this.unsub?.();
    this.unsub = null;
    this.role = "off";
    this.inputs.clear();
    this.latest = null;
    this.prev = null;
    this.roster.clear();
    this.pendingKills.length = 0;
  }

  private onRelay(from: string, data: unknown): void {
    const m = data as any;
    if (!m || typeof m.k !== "string") return;
    if (this.role === "host") {
      if (m.k === "in") this.inputs.set(from, m as NetInput);
    } else if (this.role === "client") {
      if (m.k === "snap") {
        this.prev = this.latest;
        this.latest = m;
        if (Array.isArray(m.e) && m.e.length) this.pendingKills.push(...m.e);
      } else if (m.k === "roster") {
        for (const e of m.u as RosterEntry[]) this.roster.set(e.id, e);
      }
    }
  }

  // --- host -------------------------------------------------------------

  /** The most recent input a peer sent, or null. */
  inputFor(id: string): NetInput | null {
    return this.inputs.get(id) ?? null;
  }

  broadcastSnapshot(u: UnitNetState[], e: KillEvent[]): void {
    Net.relay({ k: "snap", u, e });
  }

  broadcastRoster(u: RosterEntry[]): void {
    Net.relay({ k: "roster", u });
  }

  // --- client -----------------------------------------------------------

  sendInput(inp: NetInput): void {
    // Addressed to the host only — peers don't need each other's raw input.
    Net.relay({ k: "in", ...inp }, this.hostId);
  }
}

export const NetGame = new NetGameC();
