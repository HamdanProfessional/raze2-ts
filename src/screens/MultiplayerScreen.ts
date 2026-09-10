import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { Screen } from "../core/Screen";
import { GAME_WIDTH, GAME_HEIGHT } from "../core/Config";
import { SD } from "../state/SD";
import { Sound } from "../audio/Sounds";
import { UiArt } from "../assets/UiArt";
import { makeBackground } from "./ui";
import { MenuScreen } from "./MenuScreen";
import { Net } from "../net/Net";
import { DomInput } from "../net/DomInput";
import { defaultSettings, type RoomSummary } from "../net/protocol";
import {
  Raze2Button,
  Raze2Panel,
  FONT_HEADER,
  FONT_VALUE,
  FONT_BODY,
  C_HEADER,
  C_BODY,
  C_LABEL,
  C_WARNING,
  C_OPTIONS_GREEN,
  C_DIM,
  A_HEADER,
  A_BODY,
  A_LABEL,
} from "../ui/raze2";

/** Online multiplayer input accent — the kit's teal, used for the DOM text
 *  inputs this screen borrows from the browser (Pixi has no text entry). The
 *  DOM needs a CSS string, so the palette number is formatted rather than
 *  re-typed, keeping it in step if the token ever moves. */
const ACCENT_HEX = `#${C_OPTIONS_GREEN.toString(16).padStart(6, "0")}`;

/**
 * Online multiplayer entry point, restyled to the Raze 2 kit (doc 08 theme —
 * this flow has no SWF equivalent since Raze 2 never shipped online play, so
 * it follows the same dark-glass/teal-accent language as every other
 * restyled screen rather than a specific reference screenshot). Two phases:
 *   1. NAME — you must enter a name before anything (design requirement). The
 *      socket connects and `hello`s the central server.
 *   2. BROWSER — the public party list (auto-refreshing), a "Create Party"
 *      action (public/private) and "Join by Code".
 *
 * Entering a room (roomState) hands off to the LobbyScreen.
 */
export class MultiplayerScreen extends Screen {
  private phase: "name" | "browser" = "name";
  private content = new Container();
  private statusText!: Text;
  private inputs: DomInput[] = [];
  private unsubs: (() => void)[] = [];
  private rooms: RoomSummary[] = [];
  private refreshTicks = 0;
  private toastTicks = 0;
  private toastText!: Text;

  constructor(...args: ConstructorParameters<typeof Screen>) {
    super(...args);

    this.view.addChild(makeBackground(UiArt.getTexture("menu"), 0x0d1014));

    const title = new Text({
      text: "MULTIPLAYER",
      style: new TextStyle({
        fill: C_HEADER, fontFamily: FONT_HEADER, fontSize: 30,
        fontWeight: "700", letterSpacing: 3,
      }),
    });
    title.alpha = A_HEADER;
    title.anchor.set(0.5, 0);
    title.x = GAME_WIDTH / 2;
    title.y = 30;
    this.view.addChild(title);

    this.statusText = new Text({
      text: "",
      style: new TextStyle({ fill: C_BODY, fontFamily: FONT_BODY, fontSize: 13 }),
    });
    this.statusText.alpha = A_BODY;
    this.statusText.anchor.set(0.5, 0);
    this.statusText.x = GAME_WIDTH / 2;
    this.statusText.y = 68;
    this.view.addChild(this.statusText);

    this.view.addChild(this.content);

    this.toastText = new Text({
      text: "",
      style: new TextStyle({
        fill: C_WARNING, fontFamily: FONT_VALUE, fontSize: 15,
        stroke: { color: 0x000000, width: 3 },
      }),
    });
    this.toastText.anchor.set(0.5);
    this.toastText.x = GAME_WIDTH / 2;
    this.toastText.y = GAME_HEIGHT - 70;
    this.view.addChild(this.toastText);

    const back = new Raze2Button("Back", { width: 150, height: 40, onClick: () => this.back() });
    back.view.x = 60;
    back.view.y = GAME_HEIGHT - 60;
    back.view.on("pointerover", () => Sound.play("R2_Click"));
    this.view.addChild(back.view);

    // Wire network events.
    this.unsubs.push(
      Net.on("status", () => this.refreshStatus()),
      Net.on("welcome", () => { this.phase = "browser"; Net.listRooms(); this.rebuild(); }),
      Net.on("roomList", (rooms) => { this.rooms = rooms; if (this.phase === "browser") this.rebuild(); }),
      Net.on("roomState", () => this.enterLobby()),
      Net.on("error", (e) => this.showToast(e.message)),
    );

    // If we're already connected+named (came back from lobby), skip to browser.
    if (Net.connected && Net.selfId) {
      this.phase = "browser";
      Net.listRooms();
    }
    this.rebuild();
    this.refreshStatus();
  }

  private refreshStatus(): void {
    const map: Record<string, string> = {
      idle: "Not connected",
      connecting: "Connecting to server…",
      online: Net.selfId ? `Connected as ${Net.name}` : "Connected",
      closed: "Disconnected — check the server is running (npm run server)",
      error: "Connection failed — is the server running? (npm run server)",
    };
    this.statusText.text = map[Net.status] ?? "";
  }

  // --- phase rendering ---------------------------------------------------

  private clearContent(): void {
    this.content.removeChildren();
    for (const i of this.inputs) i.destroy();
    this.inputs = [];
  }

  private rebuild(): void {
    this.clearContent();
    if (this.phase === "name") this.buildName();
    else this.buildBrowser();
  }

  private buildName(): void {
    const cx = GAME_WIDTH / 2;
    const panel = new Raze2Panel(440, 220, { accent: C_OPTIONS_GREEN });
    panel.view.x = cx - 220;
    panel.view.y = 150;
    this.content.addChild(panel.view);

    const label = new Text({
      text: "Enter a name to play online",
      style: new TextStyle({ fill: C_LABEL, fontFamily: FONT_VALUE, fontSize: 18 }),
    });
    label.alpha = A_LABEL;
    label.anchor.set(0.5);
    label.x = cx;
    label.y = 195;
    this.content.addChild(label);

    const input = new DomInput(this.engine, {
      x: cx, y: 250, width: 300, height: 44, fontSize: 22,
      placeholder: "Your name", maxLength: 16,
      value: SD.profile?.name && SD.profile.name !== "Player" ? SD.profile.name : "",
      accent: ACCENT_HEX,
      onEnter: () => this.submitName(),
    });
    input.focus();
    this.inputs.push(input);

    const connect = new Raze2Button("Connect", { width: 220, height: 44, onClick: () => this.submitName() });
    connect.view.x = cx - 110;
    connect.view.y = 316;
    connect.view.on("pointerover", () => Sound.play("R2_Click"));
    this.content.addChild(connect.view);
  }

  private submitName(): void {
    const name = (this.inputs[0]?.value ?? "").trim();
    if (name.length < 1) { this.showToast("Please enter a name."); return; }
    Sound.play("R2_ClickGo");
    // Persist so the menu greeting + next visit remember it.
    if (SD.profile) { SD.profile.name = name.slice(0, 16); SD.save(); }
    Net.connect(name);
    this.statusText.text = "Connecting to server…";
  }

  private buildBrowser(): void {
    // Left: public party list. Both panels sit on the same 60px margin the
    // Back button uses, and run down to a matching bottom gutter — the list
    // used to start at 80 and stop 90px short of the bar.
    const rx = 680;
    const listX = 60;
    const listY = 110;
    const listW = rx - 24 - listX;
    const listH = GAME_HEIGHT - 60 - 20 - listY;
    const listPanel = new Raze2Panel(listW, listH, { accent: C_OPTIONS_GREEN });
    listPanel.view.x = listX;
    listPanel.view.y = listY;
    this.content.addChild(listPanel.view);

    const heading = new Text({
      text: "PUBLIC PARTIES",
      style: new TextStyle({ fill: C_HEADER, fontFamily: FONT_HEADER, fontSize: 16, fontWeight: "700", letterSpacing: 2 }),
    });
    heading.alpha = A_HEADER;
    heading.x = listX + 16;
    heading.y = listY + 12;
    this.content.addChild(heading);

    const refresh = new Raze2Button("Refresh", {
      width: 100, height: 30,
      onClick: () => { Sound.play("R2_Click"); Net.listRooms(); },
    });
    refresh.view.x = listX + listW - 116;
    refresh.view.y = listY + 8;
    this.content.addChild(refresh.view);

    if (this.rooms.length === 0) {
      const empty = new Text({
        text: "No public parties yet.\nCreate one on the right →",
        style: new TextStyle({ fill: C_DIM, fontFamily: FONT_BODY, fontSize: 15, align: "center" }),
      });
      empty.anchor.set(0.5);
      empty.x = listX + listW / 2;
      empty.y = listY + listH / 2;
      this.content.addChild(empty);
    } else {
      const rowH = 46;
      const maxRows = Math.floor((listH - 56) / rowH);
      this.rooms.slice(0, maxRows).forEach((r, i) => {
        const ry = listY + 50 + i * rowH;
        const full = r.players >= r.capacity || r.inGame;
        const row = new Graphics();
        row.roundRect(listX + 12, ry, listW - 24, rowH - 8, 4)
          .fill({ color: 0x000000, alpha: 0.45 })
          .stroke({ color: full ? 0x3a3f45 : C_OPTIONS_GREEN, width: 1.5, alpha: 0.7 });
        this.content.addChild(row);

        const info = new Text({
          text: `${r.name}`,
          style: new TextStyle({ fill: C_LABEL, fontFamily: FONT_VALUE, fontSize: 16 }),
        });
        info.x = listX + 24;
        info.y = ry + 5;
        this.content.addChild(info);

        const sub = new Text({
          text: `${r.type.toUpperCase()} · ${r.level} · ${r.players}/${r.capacity}${r.inGame ? " · in match" : ""}`,
          style: new TextStyle({ fill: C_DIM, fontFamily: FONT_BODY, fontSize: 11 }),
        });
        sub.x = listX + 24;
        sub.y = ry + 23;
        this.content.addChild(sub);

        if (!full) {
          const join = new Raze2Button("Join", {
            width: 84, height: 26,
            onClick: () => { Sound.play("R2_ClickGo"); Net.joinRoom(r.code); },
          });
          join.view.x = listX + listW - 100;
          join.view.y = ry + (rowH - 8) / 2 - 13;
          this.content.addChild(join.view);
        }
      });
    }

    // Right: create / join-by-code.
    const rw = GAME_WIDTH - rx - 60;
    const createPanel = new Raze2Panel(rw, listH, { accent: C_OPTIONS_GREEN });
    createPanel.view.x = rx;
    createPanel.view.y = listY;
    this.content.addChild(createPanel.view);

    const ch = new Text({
      text: "CREATE PARTY",
      style: new TextStyle({ fill: C_HEADER, fontFamily: FONT_HEADER, fontSize: 16, fontWeight: "700", letterSpacing: 2 }),
    });
    ch.alpha = A_HEADER;
    ch.x = rx + 16;
    ch.y = listY + 12;
    this.content.addChild(ch);

    const nameInput = new DomInput(this.engine, {
      x: rx + rw / 2, y: listY + 60, width: rw - 40, height: 38, fontSize: 17,
      placeholder: "Party name (optional)", maxLength: 16,
      accent: ACCENT_HEX,
    });
    this.inputs.push(nameInput);

    const createPublic = new Raze2Button("Create Public", {
      width: rw - 40, height: 40,
      onClick: () => this.create(nameInput, false),
    });
    createPublic.view.x = rx + 20;
    createPublic.view.y = listY + 96;
    createPublic.view.on("pointerover", () => Sound.play("R2_Click"));
    this.content.addChild(createPublic.view);

    const createPrivate = new Raze2Button("Create Private", {
      width: rw - 40, height: 40,
      onClick: () => this.create(nameInput, true),
    });
    createPrivate.view.x = rx + 20;
    createPrivate.view.y = listY + 144;
    createPrivate.view.on("pointerover", () => Sound.play("R2_Click"));
    this.content.addChild(createPrivate.view);

    // Join-by-code is a separate action from creating a party, so it is pinned
    // to the bottom of the (now full-height) panel behind a divider rule rather
    // than left floating in the middle with dead space under it.
    const joinY = listY + listH - 60;

    const divider = new Graphics();
    divider.rect(rx + 20, joinY - 108, rw - 40, 1).fill({ color: C_HEADER, alpha: 0.18 });
    this.content.addChild(divider);

    const jh = new Text({
      text: "JOIN BY CODE",
      style: new TextStyle({ fill: C_HEADER, fontFamily: FONT_HEADER, fontSize: 16, fontWeight: "700", letterSpacing: 2 }),
    });
    jh.alpha = A_HEADER;
    jh.x = rx + 16;
    jh.y = joinY - 90;
    this.content.addChild(jh);

    const codeInput = new DomInput(this.engine, {
      x: rx + rw / 2, y: joinY - 33, width: rw - 40, height: 42, fontSize: 24,
      placeholder: "CODE", maxLength: 8,
      accent: ACCENT_HEX,
      onInput: (v) => { codeInput.value = v.toUpperCase(); },
      onEnter: () => this.join(codeInput),
    });
    this.inputs.push(codeInput);

    const joinBtn = new Raze2Button("Join", {
      width: rw - 40, height: 40,
      onClick: () => this.join(codeInput),
    });
    joinBtn.view.x = rx + 20;
    joinBtn.view.y = joinY;
    joinBtn.view.on("pointerover", () => Sound.play("R2_Click"));
    this.content.addChild(joinBtn.view);
  }

  private create(nameInput: DomInput, isPrivate: boolean): void {
    Sound.play("R2_ClickGo");
    const s = defaultSettings();
    Net.createRoom(nameInput.value.trim(), isPrivate, s);
  }

  private join(codeInput: DomInput): void {
    const code = codeInput.value.trim().toUpperCase();
    if (code.length < 3) { this.showToast("Enter a party code."); return; }
    Sound.play("R2_ClickGo");
    Net.joinRoom(code);
  }

  private enterLobby(): void {
    // We're in a room now — hand off. Import lazily to avoid a cycle.
    void import("./LobbyScreen").then(({ LobbyScreen }) => this.engine.setScreen(LobbyScreen));
  }

  private showToast(msg: string): void {
    this.toastTicks = 120;
    this.toastText.text = msg;
    this.toastText.alpha = 1;
  }

  private back(): void {
    Sound.play("R2_ClickBack");
    // Leaving the multiplayer flow entirely: drop the socket.
    Net.disconnect();
    this.engine.setScreen(MenuScreen);
  }

  enterFrame(): void {
    for (const i of this.inputs) i.update();
    if (this.toastTicks > 0) {
      this.toastTicks--;
      this.toastText.alpha = this.toastTicks > 20 ? 1 : this.toastTicks / 20;
    }
    // Auto-refresh the public list every ~3s while browsing.
    if (this.phase === "browser") {
      if (++this.refreshTicks >= 90) { this.refreshTicks = 0; Net.listRooms(); }
    }
  }

  destructor(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    for (const i of this.inputs) i.destroy();
    this.inputs = [];
    super.destructor();
  }
}
