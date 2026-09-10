/**
 * Client-side network layer for Raze online multiplayer.
 *
 * A single long-lived WebSocket to the central lobby server (see
 * `server/index.ts`). Screens talk to this singleton: they subscribe to typed
 * events (`roomState`, `matchStart`, `relay`, …) and call the small action
 * methods (`hello`, `createRoom`, `joinRoom`, …). The in-match layer (Phase 2)
 * rides the generic `relay` channel.
 *
 * Connection URL resolution, in order:
 *   1. `import.meta.env.VITE_MP_URL`  (set for a deployed server),
 *   2. `ws://<page-host>:8787`        (dev default — server on the same box).
 */
import {
  DEFAULT_PORT,
  PROTOCOL_VERSION,
  type ClientMsg,
  type ServerMsg,
  type RoomView,
  type RoomSummary,
  type RoomSettings,
} from "./protocol";

export type NetStatus = "idle" | "connecting" | "online" | "closed" | "error";

type Handler<T> = (payload: T) => void;

/** Payload shapes delivered to subscribers, keyed by event name. */
interface NetEvents {
  status: NetStatus;
  welcome: { id: string };
  roomList: RoomSummary[];
  roomState: RoomView;
  left: void;
  error: { code: string; message: string };
  chat: { from: string; name: string; text: string };
  matchStart: { room: RoomView; hostId: string; seed: number };
  matchEnd: void;
  peerLeft: { id: string };
  relay: { from: string; data: unknown };
}

type EventName = keyof NetEvents;

function resolveUrl(): string {
  const env = (import.meta as any).env?.VITE_MP_URL as string | undefined;
  if (env) return env;
  const host = typeof location !== "undefined" ? location.hostname || "localhost" : "localhost";
  return `ws://${host}:${DEFAULT_PORT}`;
}

class NetClient {
  private ws: WebSocket | null = null;
  private handlers: { [K in EventName]?: Set<Handler<any>> } = {};
  private queue: ClientMsg[] = [];

  status: NetStatus = "idle";
  /** Our server-assigned id once `welcome` lands. */
  selfId = "";
  /** The name we last sent with `hello`, replayed on reconnect. */
  name = "";
  /** Latest full room state, or null when not in a room. */
  room: RoomView | null = null;

  get connected(): boolean {
    return this.status === "online";
  }

  /** True once we're in a room and we're its host. */
  get isHost(): boolean {
    return !!this.room && this.room.hostId === this.selfId;
  }

  // --- events -----------------------------------------------------------

  on<K extends EventName>(event: K, fn: Handler<NetEvents[K]>): () => void {
    (this.handlers[event] ??= new Set()).add(fn);
    return () => this.handlers[event]?.delete(fn);
  }

  private emit<K extends EventName>(event: K, payload: NetEvents[K]): void {
    this.handlers[event]?.forEach((fn) => {
      try {
        fn(payload);
      } catch (err) {
        console.error(`net handler for ${event} threw`, err);
      }
    });
  }

  // --- connection -------------------------------------------------------

  /**
   * Open the socket if it isn't already open. Safe to call repeatedly. If a
   * `name` is given it is remembered and a `hello` is sent as soon as the
   * socket is ready.
   */
  connect(name?: string): void {
    if (name) this.name = name;
    if (this.ws && (this.status === "connecting" || this.status === "online")) {
      if (name) this.hello(name);
      return;
    }
    this.setStatus("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(resolveUrl());
    } catch {
      this.setStatus("error");
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.setStatus("online");
      if (this.name) this.hello(this.name);
      // Flush anything that was queued while connecting.
      const pending = this.queue.splice(0);
      for (const m of pending) this.rawSend(m);
    };
    ws.onmessage = (ev) => this.receive(ev.data);
    ws.onerror = () => this.setStatus("error");
    ws.onclose = () => {
      this.ws = null;
      this.room = null;
      this.setStatus("closed");
    };
  }

  disconnect(): void {
    this.queue.length = 0;
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try {
        ws.close();
      } catch {
        /* already closing */
      }
    }
    this.room = null;
    this.setStatus("idle");
  }

  private setStatus(s: NetStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.emit("status", s);
  }

  private receive(raw: any): void {
    let msg: ServerMsg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    switch (msg.t) {
      case "welcome":
        this.selfId = msg.id;
        this.emit("welcome", { id: msg.id });
        break;
      case "roomList":
        this.emit("roomList", msg.rooms);
        break;
      case "roomState":
        this.room = msg.room;
        this.emit("roomState", msg.room);
        break;
      case "left":
        this.room = null;
        this.emit("left", undefined);
        break;
      case "error":
        this.emit("error", { code: msg.code, message: msg.message });
        break;
      case "chat":
        this.emit("chat", { from: msg.from, name: msg.name, text: msg.text });
        break;
      case "matchStart":
        this.room = msg.room;
        this.emit("matchStart", { room: msg.room, hostId: msg.hostId, seed: msg.seed });
        break;
      case "matchEnd":
        if (this.room) this.room.inGame = false;
        this.emit("matchEnd", undefined);
        break;
      case "peerLeft":
        this.emit("peerLeft", { id: msg.id });
        break;
      case "relay":
        this.emit("relay", { from: msg.from, data: msg.data });
        break;
    }
  }

  // --- sending ----------------------------------------------------------

  private rawSend(msg: ClientMsg): void {
    if (this.ws && this.status === "online") {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.queue.push(msg);
    }
  }

  hello(name: string): void {
    this.name = name;
    this.rawSend({ t: "hello", v: PROTOCOL_VERSION, name });
  }
  listRooms(): void {
    this.rawSend({ t: "listRooms" });
  }
  createRoom(name: string, isPrivate: boolean, settings: RoomSettings): void {
    this.rawSend({ t: "createRoom", name, private: isPrivate, settings });
  }
  joinRoom(code: string): void {
    this.rawSend({ t: "joinRoom", code });
  }
  leaveRoom(): void {
    this.rawSend({ t: "leaveRoom" });
  }
  setReady(ready: boolean): void {
    this.rawSend({ t: "setReady", ready });
  }
  setTeam(team: number): void {
    this.rawSend({ t: "setTeam", team });
  }
  updateSettings(settings: Partial<RoomSettings>): void {
    this.rawSend({ t: "updateSettings", settings });
  }
  startMatch(): void {
    this.rawSend({ t: "startMatch" });
  }
  endMatch(): void {
    this.rawSend({ t: "endMatch" });
  }
  chat(text: string): void {
    this.rawSend({ t: "chat", text });
  }
  /** Send a gameplay payload to the whole room (or a single peer). */
  relay(data: unknown, to?: string): void {
    this.rawSend({ t: "relay", to, data });
  }
}

/** Process-wide network singleton. */
export const Net = new NetClient();
