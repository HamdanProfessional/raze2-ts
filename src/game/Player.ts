import { Unit } from "./Unit";
import { K } from "../core/K";
import { Input } from "../core/Input";
import { CAMERA_ZOOM } from "../core/Config";
import { SD } from "../state/SD";
import { Achievements } from "./Achievements";
import { playerEquips } from "./Equipment";
import { loadoutGuns } from "./Armory";
import { activateAbility } from "./Abilities";
import { Sound } from "../audio/Sounds";
import { GUN_KEYS } from "./weapons";
import type { GameScreen } from "./GameScreen";

/**
 * Human-controlled unit. Ported from Player.as.
 *
 * The original used Flash stage KeyboardEvent/MouseEvent listeners; here we poll
 * the Input manager each frame (edge-triggered for jump / weapon-swap / respawn,
 * level-triggered for movement and auto-fire). Control scheme preserved:
 *   A/←,D/→ move · W/↑/Space jump · S/↓ crouch · 1-7 select · R reload
 *   Q/Shift prev · E next · wheel cycle · mouse aim+fire · P pause · Tab scores
 */
export class Player extends Unit {
  private prevWheel = 0;

  constructor(game: GameScreen, team: number, extra: any) {
    super(game, true, team, {
      ...extra,
      pers: extra?.pers ?? SD.profile.pers,
      // Passive equipment loadout + selected F-key ability, resolved from the
      // saved profile so their effects are live from the first spawn.
      equips: extra?.equips ?? playerEquips(),
      ability: extra?.ability ?? SD.profile.prof_ability,
      // Spawn loadout: exactly the guns equipped in the armory (the default seven
      // when the player has never set one). Index 0 is held at spawn via `gun`.
      equipGuns: extra?.equipGuns ?? loadoutGuns(),
      gun: extra?.gun ?? loadoutGuns()[0],
    });
    this.pers = extra?.pers ?? SD.profile.pers;
    this._name = SD.profile.name;
    this.setName(this._name);
    this.setCostume();
  }

  private readInput(): void {
    // Movement (level-triggered).
    this.keys = 0;
    if (Input.isDown("KeyA") || Input.isDown("ArrowLeft")) this.keys |= K.LEFT;
    if (Input.isDown("KeyD") || Input.isDown("ArrowRight")) this.keys |= K.RIGHT;
    if (Input.isDown("KeyS") || Input.isDown("ArrowDown")) this.keys |= K.DOWN;

    // Jump (edge-triggered).
    if (
      Input.wasPressed("KeyW") ||
      Input.wasPressed("ArrowUp") ||
      Input.wasPressed("Space")
    ) {
      this.keys |= K.UP;
      this.doJump(true);
    }

    // Weapon selection.
    for (let i = 0; i < GUN_KEYS.length; i++) {
      if (Input.wasPressed(GUN_KEYS[i])) this.gun.selectSlot(i);
    }
    // F activates the equipped ability (spends energy — see Abilities.ts).
    if (Input.wasPressed("KeyF")) this.useAbility();
    if (Input.wasPressed("KeyR")) this.gun.startReload();
    if (Input.wasPressed("KeyE")) this.gun.nextGun();
    if (Input.wasPressed("KeyQ") || Input.wasPressed("ShiftLeft")) this.gun.prevGun();
    if (Input.wasPressed("Tab")) SD.toggleScores();
    if (Input.wasPressed("KeyP")) SD.togglePause();
  }

  /** Fire the equipped ability if enough energy is banked; otherwise a soft
   *  denial beep so the input never feels dropped. */
  private useAbility(): void {
    if (this.status.dead || !this.game.gameStarted) return;
    if (activateAbility(this)) {
      this.game.hud?.announce?.(this.ability.name.toUpperCase(), 0x66ccff);
    } else {
      Sound.play("GunClick");
    }
  }

  /** Called by GameScreen when dead — checks for respawn click. */
  override respawnTimer(): void {
    super.respawnTimer();
    if (this.canRespawn && Input.mousePressed) this.respawn();
  }

  EnterFrame(): void {
    if (this.status.dead) return;
    if (SD.paused || !this.game.gameStarted) return;

    this.readInput();
    // Aim is measured in WORLD space now (Unit.draw() takes the angle from the
    // world-space shoulder). Convert the screen cursor back through the camera:
    // world = (screen - cameraOffset) / zoom.
    this.aimX = (Input.mouseX - this.game.arena.x) / CAMERA_ZOOM;
    this.aimY = (Input.mouseY - this.game.arena.y) / CAMERA_ZOOM;
    this.moveUnit();

    // Firing — use Input.mouseDown directly (mousePressed is edge-only,
    // unreliable after readInput resets keys). Blocked while an ability locks
    // the unit down (Static Field).
    if (Input.mouseDown && this.abilityLock <= 0) {
      this.gun.startShoot();
    } else {
      this.gun.endShoot();
    }

    // Mouse wheel weapon cycling.
    const wheel = (Input as any).wheelDelta ?? 0;
    if (wheel !== this.prevWheel) {
      if (wheel > this.prevWheel) this.gun.nextGun();
      else this.gun.prevGun();
      this.prevWheel = wheel;
    }
  }

  saveScoreStats(): void {
    SD.stats.kills += this.score.kills;
    SD.stats.deaths += this.score.deaths;
    SD.stats.suicides += this.score.suicides;
    SD.stats.headshots += this.score.headshots;
    if (SD.stats.headshots >= 50) Achievements.addAch("headshot");
    SD.stats.shots += this.score.shots;
    SD.stats.shotsHit += this.score.shotsHit;
    // bestStreak, not killStreak — the live counter is zeroed by the last death.
    if (this.score.bestStreak > SD.stats.killstreak) {
      SD.stats.killstreak = this.score.bestStreak;
    }
    // Juggernaut tallies (ticks are 30fps frames).
    SD.stats.jugTime += Math.round(this.score.jugTicks / 30);
    SD.stats.jugKills += this.score.jugKills;
    SD.save();
  }
}
