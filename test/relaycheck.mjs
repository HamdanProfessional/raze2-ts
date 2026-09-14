/**
 * End-to-end check of the BUNDLED relay, the way the deployment runs it:
 * spawn dist-server/server.mjs with HOST/PORT set, then drive two real
 * WebSocket clients through hello -> create -> join -> ready -> start -> relay.
 */
import { spawn } from "node:child_process";
import { WebSocket } from "ws";
import { PROTOCOL_VERSION } from "../src/net/protocol.ts";

const PORT = 8799;
const ROOT = "C:/Users/Hamdan/Desktop/mc/raze/raze-ts";

const srv = spawn(process.execPath, ["dist-server/server.mjs"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
srv.stdout.on("data", (d) => (log += d));
srv.stderr.on("data", (d) => (log += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : "  FAIL"} ${msg}`); if (!cond) fails.push(msg); };

function client(tag) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/raze-ws`);
  const got = [];
  ws.on("message", (r) => got.push(JSON.parse(String(r))));
  ws.on("error", (e) => { got.push({ t: "_err", e: String(e) }); });
  return {
    tag, ws, got,
    send: (m) => ws.send(JSON.stringify(m)),
    open: () => new Promise((res, rej) => {
      if (ws.readyState === 1) return res();
      ws.on("open", res); ws.on("error", rej);
    }),
    wait: async (t, ms = 3000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const hit = got.find((m) => m.t === t);
        if (hit) return hit;
        await sleep(30);
      }
      throw new Error(`${tag}: timed out waiting for '${t}'; got ${JSON.stringify(got.map((m) => m.t))}`);
    },
  };
}

try {
  // --- client URL resolution -------------------------------------------------
  // The deployed page is https, where a `ws://host:8787` dial is blocked as
  // mixed content before it ever leaves the tab. Assert the TLS branch.
  const { resolveUrl, WS_PATH } = await import("../src/net/Net.ts");
  const at = (protocol, host) => {
    globalThis.location = { protocol, host, hostname: host.split(":")[0] };
    return resolveUrl();
  };
  ok(at("https:", "raze.retris.io") === `wss://raze.retris.io${WS_PATH}`,
     `https page -> ${at("https:", "raze.retris.io")}`);
  ok(at("http:", "localhost:5199") === "ws://localhost:8787",
     `dev page -> ${at("http:", "localhost:5199")}`);
  ok(!at("https:", "raze.retris.io").startsWith("ws:"),
     "a TLS page never dials plaintext ws:// (mixed content)");
  delete globalThis.location;

  await sleep(900);
  ok(/listening on ws:\/\/127\.0\.0\.1/.test(log), `binds the host it was given (${log.trim().split("\n")[0] || "no output"})`);

  // Health through a path-mounted proxy, i.e. what nginx forwards.
  const h = await fetch(`http://127.0.0.1:${PORT}/raze-ws/health`);
  const body = await h.json();
  ok(h.status === 200 && body.ok === true, `/raze-ws/health -> 200 ${JSON.stringify(body)}`);

  const a = client("host"), b = client("guest");
  await a.open(); await b.open();
  ok(true, "both sockets opened on the /raze-ws path");

  // `welcome` is the REPLY to `hello`, not a greeting — the client speaks first.
  a.send({ t: "hello", v: PROTOCOL_VERSION, name: "Hostie" });
  b.send({ t: "hello", v: PROTOCOL_VERSION, name: "Guestie" });
  const wa = await a.wait("welcome");
  await b.wait("welcome");
  ok(wa.v === PROTOCOL_VERSION, `handshake accepted at protocol v${wa.v}`);

  const settingsRes = await fetch(`http://127.0.0.1:${PORT}/health`).then((r) => r.json());
  ok(settingsRes.clients === 2, `server sees both clients (clients=${settingsRes.clients})`);

  a.send({ t: "createRoom", name: "Test Room", private: false, settings: {} });
  const rs = await a.wait("roomState");
  const code = rs.room.code;
  ok(!!code, `host created room, code=${code}`);

  // Drain first: `hello` already pushed an (empty) roomList, and `wait` returns
  // the earliest match — without this we'd assert against the pre-create list.
  b.got.length = 0;
  b.send({ t: "listRooms" });
  const list = await b.wait("roomList");
  ok(list.rooms.some((r) => r.code === code), `public room is browsable (${list.rooms.length} listed)`);

  b.got.length = 0;
  b.send({ t: "joinRoom", code });
  const brs = await b.wait("roomState");
  ok(brs.room.players.length === 2, `guest joined, roster=${brs.room.players.length}`);

  b.send({ t: "setReady", ready: true });
  await sleep(200);
  a.got.length = 0; b.got.length = 0;
  a.send({ t: "startMatch" });
  const msA = await a.wait("matchStart");
  const msB = await b.wait("matchStart");
  ok(msA.seed === msB.seed, `matchStart broadcast, shared seed=${msA.seed}`);
  ok(msA.hostId === wa.id, "host id is the creator");

  b.got.length = 0;
  a.send({ t: "relay", data: { hello: "world", n: 42 } });
  const rl = await b.wait("relay");
  ok(rl.data?.n === 42 && rl.from === wa.id, `opaque packet relayed host->guest (${JSON.stringify(rl.data)})`);

  const guestId = brs.room.players.find((p) => p.name === "Guestie")?.id;
  a.got.length = 0;
  b.ws.close();
  const gone = await a.wait("peerLeft", 4000);
  ok(gone.id === guestId, `host is told the peer left (${gone.id})`);

  a.ws.close();
} catch (e) {
  fails.push(String(e));
  console.log("  FAIL", String(e));
} finally {
  srv.kill();
  await sleep(200);
}

console.log(fails.length ? `\nRELAY_FAIL (${fails.length})` : "\nRELAY_OK");
if (log.includes("handler error")) console.log("server log:\n" + log);
process.exit(fails.length ? 1 : 0);
