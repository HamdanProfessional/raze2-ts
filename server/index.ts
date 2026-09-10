/**
 * Raze online multiplayer — central lobby server.
 *
 * One process hosts many concurrent rooms ("parties"). Responsibilities:
 *   - accept WebSocket connections, gate them behind a name (`hello`),
 *   - let players browse public rooms, create public/private rooms, join by
 *     code, leave, ready-up, pick a team, and (host only) tweak settings,
 *   - freeze the roster and broadcast `matchStart` when the host starts,
 *   - RELAY opaque gameplay packets between room members (the host client is
 *     authoritative for the actual simulation — the server never simulates).
 *
 * Run it with Node 22's native TS support:  npm run server
 * The client dials ws://<host>:8787 (see VITE_MP_URL / src/net/Net.ts).
 *
 * Deliberately dependency-light (only `ws`) and in-memory: rooms evaporate when
 * empty and nothing is persisted. That's the right shape for a LAN/dev host;
 * swap the store for Redis if this ever needs to scale past one process.
 */
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_PORT,
  PROTOCOL_VERSION,
  CODE_ALPHABET,
  CODE_LENGTH,
  MAX_HUMANS,
  defaultSettings,
  sanitizeSettings,
  cleanName,
  type ClientMsg,
  type ServerMsg,
  type RoomSettings,
  type RoomView,
  type RoomSummary,
  type PlayerView,
} from "../src/net/protocol.ts";

const PORT = Number(process.env.PORT) || DEFAULT_PORT;

// --------------------------------------------------------------------------
// In-memory model
// --------------------------------------------------------------------------

interface Client {
  id: string;
  ws: WebSocket;
  name: string;
  /** null until the client says hello with a name. */
  named: boolean;
  roomCode: string | null;
  ready: boolean;
  team: number;
  alive: boolean; // heartbeat liveness
}

interface Room {
  code: string;
  name: string;
  private: boolean;
  hostId: string;
  settings: RoomSettings;
  /** Membership in join order; index 0 is not special — hostId is authority. */
  members: string[];
  inGame: boolean;
}

const clients = new Map<string, Client>();
const rooms = new Map<string, Room>();

// --------------------------------------------------------------------------
// Utilities
// --------------------------------------------------------------------------

function send(c: Client, msg: ServerMsg): void {
  if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
}

function fail(c: Client, code: string, message: string): void {
  send(c, { t: "error", code, message });
}

function makeCode(): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
  // Absurdly unlikely; fall back to a longer unique id.
  return randomUUID().slice(0, 8).toUpperCase();
}

function playerView(c: Client, room: Room): PlayerView {
  return {
    id: c.id,
    name: c.name,
    ready: c.ready,
    team: c.team,
    host: room.hostId === c.id,
  };
}

function roomView(room: Room): RoomView {
  const players: PlayerView[] = [];
  for (const id of room.members) {
    const c = clients.get(id);
    if (c) players.push(playerView(c, room));
  }
  return {
    code: room.code,
    name: room.name,
    private: room.private,
    hostId: room.hostId,
    settings: room.settings,
    players,
    inGame: room.inGame,
  };
}

function roomSummary(room: Room): RoomSummary {
  return {
    code: room.code,
    name: room.name,
    players: room.members.length,
    capacity: room.settings.humanCap,
    type: room.settings.type,
    level: room.settings.level,
    inGame: room.inGame,
  };
}

function broadcastRoom(room: Room): void {
  const view = roomView(room);
  const msg: ServerMsg = { t: "roomState", room: view };
  for (const id of room.members) {
    const c = clients.get(id);
    if (c) send(c, msg);
  }
}

function sendRoomList(c: Client): void {
  const list: RoomSummary[] = [];
  for (const room of rooms.values()) {
    if (!room.private) list.push(roomSummary(room));
  }
  send(c, { t: "roomList", rooms: list });
}

/** Remove a client from its room, reassign host or delete the room if empty. */
function leaveRoom(c: Client, notifyPeers = true): void {
  const code = c.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  c.roomCode = null;
  c.ready = false;
  c.team = 0;
  if (!room) return;

  const idx = room.members.indexOf(c.id);
  if (idx >= 0) room.members.splice(idx, 1);

  if (room.members.length === 0) {
    rooms.delete(code);
    return;
  }
  // Host left: promote the next member.
  if (room.hostId === c.id) {
    room.hostId = room.members[0];
    // A host change mid-match means the authority is gone; end the match so
    // clients drop back to the lobby rather than desyncing on a dead host.
    if (room.inGame) {
      room.inGame = false;
      for (const id of room.members) {
        const m = clients.get(id);
        if (m) send(m, { t: "matchEnd" });
      }
    }
  }
  if (notifyPeers && room.inGame) {
    for (const id of room.members) {
      const m = clients.get(id);
      if (m) send(m, { t: "peerLeft", id: c.id });
    }
  }
  broadcastRoom(room);
}

// --------------------------------------------------------------------------
// Message handling
// --------------------------------------------------------------------------

function handle(c: Client, msg: ClientMsg): void {
  // Everything except `hello` requires a named client.
  if (msg.t !== "hello" && !c.named) {
    fail(c, "no_name", "Enter a name first.");
    return;
  }

  switch (msg.t) {
    case "hello": {
      const name = cleanName(msg.name);
      if (!name) return fail(c, "bad_name", "That name isn't valid.");
      if (msg.v !== PROTOCOL_VERSION)
        return fail(c, "version", "Client/server version mismatch — reload.");
      c.name = name;
      c.named = true;
      send(c, { t: "welcome", id: c.id, v: PROTOCOL_VERSION });
      sendRoomList(c);
      return;
    }

    case "listRooms":
      return sendRoomList(c);

    case "createRoom": {
      if (c.roomCode) leaveRoom(c);
      const settings = { ...defaultSettings(), ...sanitizeSettings(msg.settings) };
      const room: Room = {
        code: makeCode(),
        name: cleanName(msg.name) || `${c.name}'s party`,
        private: !!msg.private,
        hostId: c.id,
        settings,
        members: [c.id],
        inGame: false,
      };
      rooms.set(room.code, room);
      c.roomCode = room.code;
      c.ready = false;
      c.team = 0;
      broadcastRoom(room);
      return;
    }

    case "joinRoom": {
      const code = String(msg.code ?? "").toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) return fail(c, "no_room", "No party with that code.");
      if (room.inGame) return fail(c, "in_game", "That party is mid-match.");
      if (room.members.length >= room.settings.humanCap)
        return fail(c, "full", "That party is full.");
      if (c.roomCode && c.roomCode !== code) leaveRoom(c);
      if (!room.members.includes(c.id)) room.members.push(c.id);
      c.roomCode = code;
      c.ready = false;
      c.team = 0;
      broadcastRoom(room);
      return;
    }

    case "leaveRoom":
      leaveRoom(c);
      send(c, { t: "left" });
      sendRoomList(c);
      return;

    case "setReady": {
      const room = c.roomCode ? rooms.get(c.roomCode) : null;
      if (!room) return;
      c.ready = !!msg.ready;
      broadcastRoom(room);
      return;
    }

    case "setTeam": {
      const room = c.roomCode ? rooms.get(c.roomCode) : null;
      if (!room) return;
      c.team = msg.team === 1 || msg.team === 2 ? msg.team : 0;
      broadcastRoom(room);
      return;
    }

    case "updateSettings": {
      const room = c.roomCode ? rooms.get(c.roomCode) : null;
      if (!room) return;
      if (room.hostId !== c.id) return fail(c, "not_host", "Only the host can change settings.");
      Object.assign(room.settings, sanitizeSettings(msg.settings));
      // Trim members if the human cap was lowered below the current count.
      while (room.members.length > room.settings.humanCap) {
        const evictedId = room.members[room.members.length - 1];
        const evicted = clients.get(evictedId);
        if (evicted) {
          leaveRoom(evicted);
          send(evicted, { t: "left" });
          fail(evicted, "kicked", "The host lowered the party size.");
        } else {
          room.members.pop();
        }
      }
      broadcastRoom(room);
      return;
    }

    case "startMatch": {
      const room = c.roomCode ? rooms.get(c.roomCode) : null;
      if (!room) return;
      if (room.hostId !== c.id) return fail(c, "not_host", "Only the host can start.");
      if (room.inGame) return;
      room.inGame = true;
      const view = roomView(room);
      const seed = (Math.random() * 0x7fffffff) | 0;
      for (const id of room.members) {
        const m = clients.get(id);
        if (m) send(m, { t: "matchStart", room: view, hostId: room.hostId, seed });
      }
      return;
    }

    case "endMatch": {
      const room = c.roomCode ? rooms.get(c.roomCode) : null;
      if (!room) return;
      if (room.hostId !== c.id) return; // only the host ends the match
      if (!room.inGame) return;
      room.inGame = false;
      for (const id of room.members) {
        const m = clients.get(id);
        if (m) {
          send(m, { t: "matchEnd" });
          send(m, { t: "roomState", room: roomView(room) });
        }
      }
      return;
    }

    case "chat": {
      const room = c.roomCode ? rooms.get(c.roomCode) : null;
      if (!room) return;
      const text = String(msg.text ?? "").slice(0, 200);
      if (!text) return;
      for (const id of room.members) {
        const m = clients.get(id);
        if (m) send(m, { t: "chat", from: c.id, name: c.name, text });
      }
      return;
    }

    case "relay": {
      const room = c.roomCode ? rooms.get(c.roomCode) : null;
      if (!room) return;
      const out: ServerMsg = { t: "relay", from: c.id, data: msg.data };
      if (msg.to) {
        const target = clients.get(msg.to);
        if (target && target.roomCode === room.code) send(target, out);
      } else {
        for (const id of room.members) {
          if (id === c.id) continue;
          const m = clients.get(id);
          if (m) send(m, out);
        }
      }
      return;
    }
  }
}

// --------------------------------------------------------------------------
// Server bootstrap
// --------------------------------------------------------------------------

const http = createServer((req, res) => {
  // Tiny health endpoint so a host can check the process is up in a browser.
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, clients: clients.size }));
    return;
  }
  res.writeHead(426, { "content-type": "text/plain" });
  res.end("Raze multiplayer server — connect over WebSocket.");
});

const wss = new WebSocketServer({ server: http });

wss.on("connection", (ws) => {
  const client: Client = {
    id: randomUUID(),
    ws,
    name: "",
    named: false,
    roomCode: null,
    ready: false,
    team: 0,
    alive: true,
  };
  clients.set(client.id, client);

  ws.on("message", (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return fail(client, "bad_json", "Malformed message.");
    }
    if (!msg || typeof (msg as any).t !== "string") return;
    try {
      handle(client, msg);
    } catch (err) {
      console.error("handler error", err);
      fail(client, "server_error", "Something went wrong handling that.");
    }
  });

  ws.on("pong", () => (client.alive = true));

  ws.on("close", () => {
    leaveRoom(client);
    clients.delete(client.id);
  });

  ws.on("error", () => {
    // 'close' will follow; nothing extra to do.
  });
});

// Heartbeat: drop dead sockets so ghost members don't linger in rooms.
const heartbeat = setInterval(() => {
  for (const c of clients.values()) {
    if (!c.alive) {
      c.ws.terminate();
      continue;
    }
    c.alive = false;
    if (c.ws.readyState === WebSocket.OPEN) c.ws.ping();
  }
}, 15000);
wss.on("close", () => clearInterval(heartbeat));

http.listen(PORT, () => {
  console.log(`[raze] multiplayer lobby server listening on ws://0.0.0.0:${PORT}`);
  console.log(`[raze] health check: http://localhost:${PORT}/health`);
});
