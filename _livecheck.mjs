import { WebSocket } from "ws";
import { PROTOCOL_VERSION } from "./src/net/protocol.ts";
const URL = "wss://raze.retris.io/raze-ws";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function cli(name) {
  const ws = new WebSocket(URL); const got = [];
  ws.on("message", (r) => got.push(JSON.parse(String(r))));
  return { ws, got, name,
    send: (m) => ws.send(JSON.stringify(m)),
    open: () => new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); }),
    wait: async (t, ms = 8000) => { const e = Date.now() + ms;
      while (Date.now() < e) { const h = got.find((m) => m.t === t); if (h) return h; await sleep(40); }
      throw new Error(`${name}: no '${t}', got ${JSON.stringify(got.map(m=>m.t))}`); } };
}
const a = cli("host"), b = cli("guest");
await a.open(); await b.open();
console.log("  ok   TLS WebSocket upgrade accepted through nginx");
a.send({ t: "hello", v: PROTOCOL_VERSION, name: "LiveHost" });
b.send({ t: "hello", v: PROTOCOL_VERSION, name: "LiveGuest" });
const wa = await a.wait("welcome"); await b.wait("welcome");
console.log(`  ok   handshake v${wa.v}, id=${wa.id.slice(0, 8)}`);
a.send({ t: "createRoom", name: "Live Check", private: false, settings: {} });
const rs = await a.wait("roomState");
console.log(`  ok   room created on the live server, code=${rs.room.code}`);
b.got.length = 0; b.send({ t: "joinRoom", code: rs.room.code });
const j = await b.wait("roomState");
console.log(`  ok   second client joined, roster=${j.room.players.length}`);
b.got.length = 0; a.send({ t: "relay", data: { ping: 7 } });
const rl = await b.wait("relay");
console.log(`  ok   gameplay packet relayed across the internet (${JSON.stringify(rl.data)})`);
a.ws.close(); b.ws.close();
console.log("\nLIVE_MP_OK");
