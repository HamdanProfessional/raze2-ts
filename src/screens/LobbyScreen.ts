import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { Screen } from "../core/Screen";
import { GAME_WIDTH, GAME_HEIGHT } from "../core/Config";
import { SD } from "../state/SD";
import { Sound } from "../audio/Sounds";
import { UiArt } from "../assets/UiArt";
import { makeBackground, makeVeil } from "./ui";
import { Net } from "../net/Net";
import { LEVELS } from "../game/Arena";
import { MAX_HUMANS, type RoomView, type RoomSettings } from "../net/protocol";
import { teamColor, teamName } from "../ui/raze2/palette";
import {
  Raze2Button,
  Raze2Panel,
  FONT_HEADER,
  FONT_VALUE,
  C_HEADER,
  C_LABEL,
  C_DIM,
  C_WARNING,
  C_OPTIONS_GREEN,
  A_HEADER,
  A_LABEL,
} from "../ui/raze2";

/**
 * The party lobby, restyled to the Raze 2 kit (see `MultiplayerScreen.ts` doc
 * comment — this flow is a port-only addition with no SWF equivalent, so it
 * follows the shared dark-glass/teal-accent language rather than a specific
 * reference screenshot). Shows the room code, the live roster (host / ready /
 * team), the match settings (editable by the host, read-only for everyone
 * else) and the READY / START controls. Rebuilds from each `roomState` push
 * so it always mirrors the server. `matchStart` launches the game.
 */

const TYPES = ["dm", "tdm", "elim", "telim"];
const TYPE_LABELS: Record<string, string> = {
  dm: "Free-for-all", tdm: "Team DM", elim: "Elimination", telim: "Team Elim",
};
const DIFFS = [0.8, 1.2, 2, 2.8];
const DIFF_LABELS = ["Easy", "Medium", "Hard", "Ego"];
const SCORES = [10, 15, 20, 30, 50];
const LIVES = [1, 3, 5, 10];
const DMG = [0.5, 1, 1.5, 3];
const DMG_LABELS = ["x0.5", "Normal", "x1.5", "x3"];

export class LobbyScreen extends Screen {
  private content = new Container();
  private unsubs: (() => void)[] = [];
  private toastText!: Text;
  private toastTicks = 0;

  constructor(...args: ConstructorParameters<typeof Screen>) {
    super(...args);

    this.view.addChild(makeBackground(UiArt.getTexture("menu"), 0x0d1014));
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
    this.toastText.y = GAME_HEIGHT - 66;
    this.view.addChild(this.toastText);

    this.unsubs.push(
      Net.on("roomState", () => this.rebuild()),
      Net.on("left", () => this.leaveToBrowser()),
      Net.on("error", (e) => this.showToast(e.message)),
      Net.on("matchStart", (m) => this.startMatch(m)),
      Net.on("status", (s) => { if (s === "closed" || s === "error") this.leaveToBrowser(); }),
    );

    if (!Net.room) { this.leaveToBrowser(); return; }
    this.rebuild();
  }

  private get room(): RoomView | null {
    return Net.room;
  }

  private rebuild(): void {
    const room = this.room;
    if (!room) return;
    this.content.removeChildren();

    // Header: title + code.
    const title = new Text({
      text: room.name,
      style: new TextStyle({
        fill: C_HEADER, fontFamily: FONT_HEADER, fontSize: 30,
        fontWeight: "700", letterSpacing: 2,
      }),
    });
    title.alpha = A_HEADER;
    title.anchor.set(0.5, 0);
    title.x = GAME_WIDTH / 2;
    title.y = 24;
    this.content.addChild(title);

    const code = new Text({
      text: `${room.private ? "PRIVATE · " : "PUBLIC · "}CODE ${room.code}`,
      style: new TextStyle({ fill: C_OPTIONS_GREEN, fontFamily: FONT_VALUE, fontSize: 16, letterSpacing: 2 }),
    });
    code.anchor.set(0.5, 0);
    code.x = GAME_WIDTH / 2;
    code.y = 62;
    this.content.addChild(code);

    this.buildRoster(room);
    this.buildSettings(room);
    this.buildControls(room);
  }

  // --- roster ------------------------------------------------------------

  private buildRoster(room: RoomView): void {
    const x = 70, y = 110, w = 470, h = 400;
    const panel = new Raze2Panel(w, h, { accent: C_OPTIONS_GREEN });
    panel.view.x = x;
    panel.view.y = y;
    this.content.addChild(panel.view);

    const heading = new Text({
      text: `PLAYERS  ${room.players.length}/${room.settings.humanCap}`,
      style: new TextStyle({ fill: C_HEADER, fontFamily: FONT_HEADER, fontSize: 16, fontWeight: "700", letterSpacing: 2 }),
    });
    heading.alpha = A_HEADER;
    heading.x = x + 16;
    heading.y = y + 12;
    this.content.addChild(heading);

    const teamMode = room.settings.type === "tdm" || room.settings.type === "telim";
    const rowH = 40;
    room.players.forEach((p, i) => {
      const ry = y + 46 + i * rowH;
      const me = p.id === Net.selfId;
      const row = new Graphics();
      row.roundRect(x + 12, ry, w - 24, rowH - 8, 4)
        .fill({ color: me ? 0x123322 : 0x000000, alpha: me ? 0.5 : 0.45 })
        .stroke({ color: p.ready ? C_OPTIONS_GREEN : 0x3a3f45, width: 1.5, alpha: 0.8 });
      this.content.addChild(row);

      const tag = new Text({
        text: `${p.host ? "★ " : ""}${p.name}${me ? "  (you)" : ""}`,
        style: new TextStyle({ fill: p.host ? C_OPTIONS_GREEN : C_LABEL, fontFamily: FONT_VALUE, fontSize: 16 }),
      });
      tag.x = x + 24;
      tag.y = ry + 7;
      this.content.addChild(tag);

      if (teamMode) {
        // Sides are Blue / Orange, never red — see `TEAM_NAMES`.
        const teamLabel = p.team ? teamName(p.team).toUpperCase() : "—";
        const teamTint = p.team ? teamColor(p.team) : C_DIM;
        const tt = new Text({
          text: teamLabel,
          style: new TextStyle({ fill: teamTint, fontFamily: FONT_VALUE, fontSize: 13 }),
        });
        tt.anchor.set(1, 0);
        tt.x = x + w - 90;
        tt.y = ry + 9;
        this.content.addChild(tt);
      }

      const status = new Text({
        text: p.ready ? "READY" : "…",
        style: new TextStyle({ fill: p.ready ? C_OPTIONS_GREEN : C_DIM, fontFamily: FONT_VALUE, fontSize: 13 }),
      });
      status.anchor.set(1, 0);
      status.x = x + w - 24;
      status.y = ry + 9;
      this.content.addChild(status);
    });

    // Team pick buttons for team modes (self only).
    if (teamMode) {
      const by = y + h - 44;
      const red = new Raze2Button("Join Red", {
        width: 150, height: 34,
        onClick: () => { Sound.play("R2_Click"); Net.setTeam(1); },
      });
      red.view.x = x + w / 2 - 165;
      red.view.y = by - 17;
      this.content.addChild(red.view);

      const blue = new Raze2Button("Join Blue", {
        width: 150, height: 34,
        onClick: () => { Sound.play("R2_Click"); Net.setTeam(2); },
      });
      blue.view.x = x + w / 2 + 15;
      blue.view.y = by - 17;
      this.content.addChild(blue.view);
    }
  }

  // --- settings ----------------------------------------------------------

  private buildSettings(room: RoomView): void {
    const x = 580, y = 110, w = GAME_WIDTH - x - 70, h = 400;
    const panel = new Raze2Panel(w, h, { accent: C_OPTIONS_GREEN });
    panel.view.x = x;
    panel.view.y = y;
    this.content.addChild(panel.view);

    const isHost = Net.isHost;
    const heading = new Text({
      text: isHost ? "MATCH SETTINGS (HOST)" : "MATCH SETTINGS",
      style: new TextStyle({ fill: C_HEADER, fontFamily: FONT_HEADER, fontSize: 15, fontWeight: "700", letterSpacing: 1 }),
    });
    heading.alpha = A_HEADER;
    heading.x = x + 16;
    heading.y = y + 12;
    this.content.addChild(heading);

    const s = room.settings;
    const rowY = (i: number) => y + 46 + i * 42;

    const levelName = (id: string) => LEVELS.find((l) => l.id === id)?.name ?? id;
    const rows: { label: string; next: () => Partial<RoomSettings> }[] = [
      { label: `Level:  ${levelName(s.level)}`, next: () => ({ level: cycle(LEVELS.map((l) => l.id), s.level) }) },
      { label: `Mode:  ${TYPE_LABELS[s.type] ?? s.type}`, next: () => ({ type: cycle(TYPES, s.type) }) },
      { label: `Max players:  ${s.humanCap}`, next: () => ({ humanCap: s.humanCap >= MAX_HUMANS ? 2 : s.humanCap + 1 }) },
      { label: `Bots:  ${s.bots}`, next: () => ({ bots: s.bots >= 14 ? 0 : s.bots + 1 }) },
      { label: `Bot difficulty:  ${DIFF_LABELS[Math.max(0, DIFFS.indexOf(s.diff))] ?? "Medium"}`, next: () => ({ diff: cycle(DIFFS, s.diff) }) },
      s.type === "elim" || s.type === "telim"
        ? { label: `Lives:  ${s.lives || 5}`, next: () => ({ lives: cycle(LIVES, s.lives || 5) }) }
        : { label: `Score cap:  ${s.score}`, next: () => ({ score: cycle(SCORES, s.score) }) },
      { label: `Friendly fire:  ${s.ff ? "ON" : "OFF"}`, next: () => ({ ff: !s.ff }) },
      { label: `Damage:  ${DMG_LABELS[Math.max(0, DMG.indexOf(s.dmgMod))] ?? "Normal"}`, next: () => ({ dmgMod: cycle(DMG, s.dmgMod) }) },
    ];

    rows.forEach((r, i) => {
      if (isHost) {
        const btn = new Raze2Button(r.label, {
          width: w - 32, height: 34,
          onClick: () => { Sound.play("R2_Click"); Net.updateSettings(r.next()); },
        });
        btn.view.x = x + 16;
        btn.view.y = rowY(i) - 17;
        this.content.addChild(btn.view);
      } else {
        const t = new Text({
          text: r.label,
          style: new TextStyle({ fill: C_LABEL, fontFamily: FONT_VALUE, fontSize: 15 }),
        });
        t.alpha = A_LABEL;
        t.anchor.set(0.5);
        t.x = x + w / 2;
        t.y = rowY(i);
        this.content.addChild(t);
      }
    });
  }

  // --- controls ----------------------------------------------------------

  private buildControls(room: RoomView): void {
    const me = room.players.find((p) => p.id === Net.selfId);
    const y = GAME_HEIGHT - 60;

    const leave = new Raze2Button("Leave", {
      width: 150, height: 44,
      onClick: () => { Sound.play("R2_ClickBack"); Net.leaveRoom(); },
    });
    // Aligned with the roster panel's left edge rather than floating 25px
    // further out toward the stage edge.
    leave.view.x = 70;
    leave.view.y = y;
    this.content.addChild(leave.view);

    const readyLabel = me?.ready ? "Unready" : "Ready";
    const ready = new Raze2Button(readyLabel, {
      width: 200, height: 44,
      onClick: () => { Sound.play("R2_Click"); Net.setReady(!me?.ready); },
    });
    ready.view.x = GAME_WIDTH / 2 - 230;
    ready.view.y = y;
    ready.setSelected(!!me?.ready);
    this.content.addChild(ready.view);

    if (Net.isHost) {
      const allReady = room.players.length > 0 &&
        room.players.every((p) => p.ready || p.host);
      const canStart = room.players.length >= 1; // host can start solo-with-bots too
      const start = new Raze2Button("Start", {
        width: 200, height: 44,
        onClick: () => {
          if (!canStart) { this.showToast("Need at least one player."); return; }
          if (!allReady) { this.showToast("Waiting for players to ready up…"); return; }
          Sound.play("R2_ClickGo");
          Net.startMatch();
        },
      });
      start.view.x = GAME_WIDTH / 2 + 30;
      start.view.y = y;
      start.setSelected(allReady);
      this.content.addChild(start.view);
    } else {
      const waiting = new Text({
        text: "Waiting for the host to start…",
        style: new TextStyle({ fill: C_DIM, fontFamily: FONT_VALUE, fontSize: 14 }),
      });
      waiting.anchor.set(0.5);
      waiting.x = GAME_WIDTH / 2 + 130;
      waiting.y = y + 20;
      this.content.addChild(waiting);
    }
  }

  // --- match handoff -----------------------------------------------------

  private startMatch(m: { room: RoomView; hostId: string; seed: number }): void {
    const s = m.room.settings;
    const me = m.room.players.find((p) => p.id === Net.selfId);
    // Configure the shared match settings from the room.
    SD.matchSettings = {
      type: s.type,
      diff: s.diff,
      egoMode: s.diff >= 2.8,
      opponents: s.bots,
      level: s.level,
      score: s.score,
      lives: (s.type === "elim" || s.type === "telim") ? (s.lives || 5) : 0,
      team: (s.type === "tdm" || s.type === "telim") ? (me?.team || 1) : 0,
      ff: s.ff,
      dmgMod: s.dmgMod,
    };
    // Stash the multiplayer context for the in-match net layer (Phase 2).
    (SD as any).mp = {
      seed: m.seed,
      hostId: m.hostId,
      selfId: Net.selfId,
      isHost: Net.selfId === m.hostId,
      players: m.room.players,
    };
    this.view.addChild(makeVeil("LOADING MAP…"));
    void (async () => {
      // Arena reads the backdrop and mask synchronously, and neither is held
      // from boot; both live in the same lazy chunk as GameScreen.
      const [{ GameScreen }, { preloadLevel }] = await Promise.all([
        import("../game/GameScreen"),
        import("../game/Arena"),
      ]);
      await preloadLevel(String(s.level));
      this.engine.setScreen(GameScreen);
    })();
  }

  private leaveToBrowser(): void {
    void import("./MultiplayerScreen").then(({ MultiplayerScreen }) => this.engine.setScreen(MultiplayerScreen, undefined, "slideRight"));
  }

  private showToast(msg: string): void {
    this.toastTicks = 120;
    this.toastText.text = msg;
    this.toastText.alpha = 1;
  }

  enterFrame(): void {
    if (this.toastTicks > 0) {
      this.toastTicks--;
      this.toastText.alpha = this.toastTicks > 20 ? 1 : this.toastTicks / 20;
    }
  }

  destructor(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    super.destructor();
  }
}

/** Return the element after `cur` in `arr`, wrapping; falls back to arr[0]. */
function cycle<T>(arr: T[], cur: T): T {
  const i = arr.indexOf(cur);
  return arr[(i + 1) % arr.length] ?? arr[0];
}
