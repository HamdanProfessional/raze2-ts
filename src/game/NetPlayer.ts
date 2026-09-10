import { Unit } from "./Unit";
import { K } from "../core/K";
import { SD } from "../state/SD";
import { NetGame } from "../net/NetGame";
import type { GameScreen } from "./GameScreen";

const DEG = Math.PI / 180;

/**
 * Host-side stand-in for a remote human. Ported behaviour from Player, but the
 * control source is the peer's transmitted `NetInput` (via NetGame) instead of
 * the local keyboard/mouse. Fully simulated on the host like any other unit;
 * the peer only sees the resulting snapshot.
 */
export class NetPlayer extends Unit {
  constructor(game: GameScreen, team: number, extra: any) {
    super(game, true, team, extra);
    this._name = extra?.name ?? "Player";
    this.setName(this._name);
    this.setCostume();
  }

  EnterFrame(): void {
    if (this.status.dead) return;
    if (SD.paused || !this.game.gameStarted) return;

    const inp = NetGame.inputFor(this.netId);
    if (!inp) {
      // No packet yet — coast to a stop.
      this.keys = 0;
      this.moveUnit();
      this.gun.endShoot();
      return;
    }

    // Movement (level-triggered bits only).
    this.keys = inp.keys & (K.LEFT | K.RIGHT | K.DOWN);

    // Edge actions — consumed once so a stale packet can't repeat them.
    if (inp.jump) {
      this.keys |= K.UP;
      this.doJump(true);
      inp.jump = 0;
    }
    if (inp.gun) {
      this.gun.selectGun(inp.gun);
      inp.gun = "";
    }
    if (inp.cycle > 0) this.gun.nextGun();
    else if (inp.cycle < 0) this.gun.prevGun();
    inp.cycle = 0;
    if (inp.reload) {
      this.gun.startReload();
      inp.reload = 0;
    }

    // Aim: rebuild a WORLD-space aim point from the transmitted angle around
    // this unit's own (world) shoulder, so facing + arm + muzzle all resolve
    // exactly as they would for a local player.
    const sh = this.getShoulder();
    const rad = inp.aim * DEG;
    this.aimX = sh.x + Math.cos(rad) * 1000;
    this.aimY = sh.y + Math.sin(rad) * 1000;

    this.moveUnit();

    if (inp.fire) this.gun.startShoot();
    else this.gun.endShoot();
  }

  /** AI-free: no respawn-on-timer; the peer clicks to respawn (host trusts it). */
  override respawnTimer(): void {
    super.respawnTimer();
    const inp = NetGame.inputFor(this.netId);
    if (this.canRespawn && inp && inp.fire) this.respawn();
  }
}
