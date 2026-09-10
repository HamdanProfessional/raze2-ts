import { UT } from "../core/UT";
import { SD } from "../state/SD";
import { Sound } from "../audio/Sounds";
import {
  WEAPONS, GUN_ORDER, SLOT_GUNS, makeGun, kickOf, resolveLoadout,
  type WeaponDef, type TracerStyle, type TracerOpts,
} from "./weapons";
import { Quality } from "../state/Quality";
import { Projectile } from "./Projectile";
import { canHarm } from "./Match";
import { Achievements } from "./Achievements";

// Fire / reload sounds are data-driven off each weapon's def
// (`fireSound`/`reloadSound`, wired for all 36 guns in weapons.ts).
/**
 * Sound at the *end* of the reload — the slide going forward / the bolt being
 * worked, as opposed to the weapon's `reloadSound`, which is the magazine going
 * in at the start. Having both bookends is most of what makes a reload feel
 * mechanical rather than like a cooldown timer.
 *
 * Keyed by the weapon's reload arm-rig (`frameReload`) rather than by id, since
 * what closes a reload is the mechanism being worked, and the rig IS the
 * mechanism — every gun on the sniper rig works a bolt, every gun on the rocket
 * rig seats a tube.
 */
const RELOAD_END_SOUND: Record<string, string> = {
  pistol: "Assault_Slide", rifle: "Assault_Slide", shotgun: "SGClip",
  sniper: "Pull", heavy: "Assault_Slide", rocket: "nadeClipout",
};
const HEADSHOT_SOUNDS = ["Headshot1", "Headshot2", "Headshot3"];

type LiveGun = WeaponDef & { curClip: number; curAmmo: number };

/**
 * Per-unit weapon controller. Ported from Guns.as (arsenal, selection, reload,
 * shooting). The original drove fire-rate off weapon animation frames; since
 * those animations are art-driven, we use a per-weapon cooldown instead, taken
 * straight from each gun's `shootDelay` (`def.fireDelay`).
 */

/** Fallback reload duration when a weapon has no per-rig `reloadFrames`. */
const RELOAD_FRAMES = 40;

/**
 * Recoil tuning. The logic tick is a fixed 30Hz, so 6 frames ≈ 0.2s — the
 * window over which a shot's kick washes out.
 */
/** Per-frame decay: 0.72^6 ≈ 0.14, so the kick is spent inside ~0.2s. */
const RECOIL_DECAY = 0.72;
/**
 * How much a fully-hot burst widens the shot cone. `Guns.as` lets `dynRecoil`
 * climb from `curGun.recoil` to `curGun.recoil * 1.7` under sustained fire
 * (`:411-413`) and bleeds it back down (`:202-204`), so 1.7 is the original's
 * ceiling. Applied against `recoilAmount`, which is this port's `dynRecoil`.
 */
const RECOIL_SPREAD_MAX = 1.7;
/** Weapons below this punch don't shove the shooter at all. */
const KNOCKBACK_MIN_KICK = 0.4;
/** Initial px/frame of shooter knockback at kick 1. */
const KNOCKBACK_PX = 4;
/** Ticks between barrel-smoke puffs while the barrel is still hot. */
const SMOKE_INTERVAL = 4;

/**
 * Hearing ranges, in arena pixels, for this weapon's sounds (see Sound.playAt).
 *
 * A gunshot carries right across the map — hearing an unseen firefight is a
 * tactical cue, not noise. The mechanical sounds do not: a magazine seating or
 * a dry trigger click is only audible to someone standing near the shooter, so
 * a room full of reloading bots doesn't wash out everything else.
 */
const GUNSHOT_RANGE = 1600;
const MECHANICAL_RANGE = 520;
/** Headshot stingers are feedback, so they carry as far as the shot did. */
const HEADSHOT_RANGE = 1600;

export class Guns {
  private unit: any;
  arsenal: Record<string, LiveGun> = {};
  curGun!: LiveGun;
  private curGunName = "pistol";
  gunOrder = GUN_ORDER.slice();

  reloading = false;
  private reloadTimer = 0;
  private reloadLen = RELOAD_FRAMES;
  private cooldown = 0;
  /** For auto-fire weapons: whether the trigger is held. */
  private firing = false;
  /**
   * Monotonic shot counter. Throttles the fire sound for beam weapons
   * (`soundFrames`), and `Unit` watches it for the edge that restarts the
   * weapon's `_fire` recoil animation — the equivalent of `Guns.as` calling
   * `setFrame("fire")` on every trigger pull.
   */
  shotCount = 0;

  spawnWeapon = "pistol";
  private defaultGun = "pistol";
  lookAngle = 0;
  reloadAngle = 0;
  /**
   * Unsigned 0..~1.5 measure of how hot the recoil currently is (a burst
   * stacks). This is the port's `dynRecoil` (`Guns.as:202-226,411-413`): recoil
   * does not bend the aim, it opens the cone. It drives the shot spread below,
   * the crosshair bloom, and renderer shake.
   *
   * The *visible* kick is not here at all — it is the weapon's authentic
   * `_fire` animation band (see `ArmAnim`), which is why `Unit.as:1123` can
   * write `MC.arm1.rotation = rotReload + rotArm` with no recoil term.
   */
  recoilAmount = 0;
  /** Linear 0..1 progress through the current reload (0 when not reloading). */
  reloadProgress = 0;

  /** Remaining barrel-smoke budget; each puff burns one unit. */
  private smokeHeat = 0;
  private smokeTimer = 0;

  constructor(unit: any) {
    this.unit = unit;
    this.spawnWeapon = "pistol";
    if (SD.matchSettings.weapons) this.spawnWeapon = GUN_ORDER[0];
    if (unit.extra?.gun) this.spawnWeapon = unit.extra.gun;
    if (unit.extra?.infAmmoGun) this.spawnWeapon = unit.extra.infAmmoGun;
    this.defaultGun = this.spawnWeapon;
    this.reset();
  }

  reset(): void {
    this.arsenal = {};
    this.reloading = false;
    this.cooldown = 0;
    this.firing = false;
    this.recoilAmount = 0;
    this.smokeHeat = 0;
    this.smokeTimer = 0;
    // Starting arsenal. Raze 2 gives every unit one gun per type-slot 0–6
    // (doc 03 §6): when the loadout supplies a per-slot index array
    // (`extra.weapons`, matching Raze 2's matchInfo.weapons), spawn holding
    // exactly those seven — which lets any genuine Raze 2 gun be the real
    // equipped weapon per category. Otherwise fall back to the port's arcade
    // "whole arsenal available" behaviour (the native holdovers).
    const loadout: string[] | undefined = this.unit.extra?.weapons
      ? resolveLoadout(this.unit.extra.weapons as number[])
      : undefined;
    const equipGuns: string[] = this.unit.extra?.equipGuns ?? [];
    // Rack/hotkey order for this life, before pickups extend it.
    this.gunOrder = loadout ?? (equipGuns.length ? [...equipGuns] : GUN_ORDER.slice());
    if (loadout) {
      for (const id of loadout) this.addGun(id);
      // Spawn on the pistol slot unless a specific spawn weapon was set.
      if (!this.unit.extra?.gun && loadout[0]) this.defaultGun = loadout[0];
    } else if (equipGuns.length) {
      // The armory loadout IS the arsenal — buying and equipping a gun has to
      // change what you carry, not just append to a fixed seven.
      for (const id of equipGuns) this.addGun(id);
      if (!this.unit.extra?.gun) this.defaultGun = equipGuns[0];
    } else {
      for (const id of GUN_ORDER) this.addGun(id);
    }
    // Weapon-set restriction (doc 11 §6): outside campaign, `weaponsUsed` locks
    // every unit to a single weapon category. "All" = no restriction. Any other
    // category forces the arsenal down to just that slot's gun (the unit's own
    // per-slot loadout selection if it has one, else the slot's base gun).
    this.applyWeaponRestriction();
    if (!this.arsenal[this.defaultGun]) {
      this.defaultGun = this.gunOrder.find((id) => this.arsenal[id]) ?? "pistol";
    }
    this.selectGun(this.defaultGun);
  }

  /**
   * Category names for `weaponsUsed`, index-aligned so
   * `WEAPON_CATEGORIES.indexOf(name) - 1` is the SLOT_GUNS slot (doc 11 §6:
   * "Starters"->0, "Sidearms"->1, ... "Explosives"->6; "All"->no restriction).
   */
  private static readonly WEAPON_CATEGORIES = [
    "All", "Starters", "Sidearms", "Close Range",
    "Automatics", "Long Range", "Heavies", "Explosives",
  ];

  /** Collapse the arsenal to a single weapon category, per `weaponsUsed`. */
  private applyWeaponRestriction(): void {
    if (SD.matchSettings.campaign) return; // campaign uses scripted loadouts
    const wu = SD.matchSettings.weaponsUsed;
    if (!wu || wu === "All") return;
    const slot = Guns.WEAPON_CATEGORIES.indexOf(String(wu)) - 1;
    if (slot < 0) return;
    const guns = SLOT_GUNS[slot];
    if (!guns || !guns.length) return;
    // Prefer the unit's chosen gun in that slot; else the slot's base gun.
    const sel = this.unit.extra?.weapons?.[slot];
    const idx = typeof sel === "number" ? Math.max(0, Math.min(guns.length - 1, sel)) : 0;
    const gunId = guns[idx] ?? guns[0];
    if (!gunId || !WEAPONS[gunId]) return;
    this.arsenal = {};
    this.addGun(gunId);
    this.defaultGun = gunId;
  }

  /** Put `id` into the arsenal fully stocked — the spawn loadout path. Walking
   *  over a weapon crate goes through {@link pickUpGun} instead. */
  addGun(id: string): void {
    if (!WEAPONS[id]) return;
    if (this.arsenal[id]) {
      const g = this.arsenal[id];
      if (g.oneClip) g.curClip = Math.min(g.maxClip, g.curClip + g.maxClip);
      else g.curAmmo = Math.min(g.maxAmmo, g.curAmmo + WEAPONS[id].curAmmo);
    } else {
      this.arsenal[id] = makeGun(id);
      // Weapons picked up beyond the default arsenal join the Q/E cycle order.
      if (!this.gunOrder.includes(id)) this.gunOrder.push(id);
    }
    // Extra Clips (equips.ammo): spawn with every weapon at a full load.
    if (this.unit.equips?.ammo) {
      const g = this.arsenal[id];
      g.curClip = g.maxClip;
      if (!g.oneClip) g.curAmmo = g.maxAmmo;
    }
  }

  /** Strip every carried gun bare — the `noAmmo` opening some missions use. */
  emptyAll(): void {
    for (const g of Object.values(this.arsenal)) {
      g.curClip = 0;
      g.curAmmo = 0;
    }
  }

  /** Hand back a full load on every carried gun. */
  refillAll(): void {
    for (const g of Object.values(this.arsenal)) {
      g.curClip = g.maxClip;
      if (!g.oneClip) g.curAmmo = g.maxAmmo;
    }
  }

  /**
   * Add `clips` spare clips to the weapon `id` (`Guns.addClip(gunNum, clips)`).
   *
   * Reserve ammo is counted in rounds here, so a clip is `maxClip` of them. This
   * only feeds the *reserve* — it deliberately does not top up the loaded
   * magazine, so a resupply mid-magazine still costs you a reload. Weapons whose
   * reserve IS the clip (`oneClip`: chaingun, zapper, flamethrower) have no
   * separate pool, so their top-up goes straight into `curClip`.
   *
   * Extra Clips (`equips.ammo`) overrides the count to 999 — the original applies
   * that here rather than at the call site, so every path that adds a clip gets
   * it (`Guns.as:130-135`, doc 07 §equipment).
   */
  addClip(id: string, clips: number): void {
    const g = this.arsenal[id];
    if (!g) return;
    const n = this.unit.equips?.ammo ? 999 : clips;
    if (g.oneClip) g.curClip = Math.min(g.maxClip, g.curClip + n * g.maxClip);
    else g.curAmmo = Math.min(g.maxAmmo, g.curAmmo + n * g.maxClip);
  }

  /** Spare magazines this weapon can stock (`Stats_Guns.clipMax`). `oneClip`
   *  weapons keep no reserve, so their whole drum counts as the one clip. */
  private clipMax(g: LiveGun): number {
    return g.oneClip ? 1 : Math.max(1, Math.round(g.maxAmmo / g.maxClip));
  }

  /**
   * Walk over a weapon crate (`NodePickup.getPickup`, doc 12 §5).
   *
   * A crate is a top-up, not a rearm: it grants `ceil(clipMax/2)` spare clips —
   * half the reserve the weapon can stock — where the port used to hand over the
   * full reserve every time.
   *
   * A weapon you are not already carrying is created first. The original has no
   * equivalent case (there, every unit owns all seven slot guns from spawn, so a
   * crate is only ever ammo), so the port picks the reading that keeps the crate
   * worth the same either way: the gun arrives loaded and usable, but with the
   * same half reserve a gun you already carry would have got. Handing new guns
   * the full spawn load instead would make *skipping* a weapon in the armory the
   * better way to stock it.
   */
  pickUpGun(id: string): void {
    if (!WEAPONS[id]) return;
    let g = this.arsenal[id];
    if (!g) {
      g = this.arsenal[id] = makeGun(id);
      g.curAmmo = 0; // loaded magazine, empty reserve for addClip to part-fill
      // Weapons picked up beyond the default arsenal join the Q/E cycle order.
      if (!this.gunOrder.includes(id)) this.gunOrder.push(id);
    }
    this.addClip(id, Math.ceil(this.clipMax(g) / 2));
  }

  /** The gun on rack slot `n` — the same packing the HUD draws. */
  gunAtSlot(n: number): string | undefined {
    return this.gunOrder.filter((id) => this.arsenal[id])[n];
  }

  /** Number-row selection: pick the n-th carried gun. */
  selectSlot(n: number): void {
    const id = this.gunAtSlot(n);
    if (id) this.selectGun(id);
  }

  selectGun(id: string): void {
    if (!id || !this.arsenal[id]) return;
    if (this.arsenal[id].oneClip !== true && this.isEmpty(this.arsenal[id])) return;
    this.curGunName = id;
    this.curGun = this.arsenal[id];
    this.reloading = false;
  }

  private isEmpty(g: LiveGun): boolean {
    return g.curClip <= 0 && g.curAmmo <= 0 && !g.infAmmo;
  }

  private cycle(dir: number): void {
    const owned = this.gunOrder.filter(
      (id) => this.arsenal[id] && !this.isEmpty(this.arsenal[id]),
    );
    if (!owned.length) return;
    let i = owned.indexOf(this.curGunName);
    i = (i + dir + owned.length) % owned.length;
    this.selectGun(owned[i]);
  }
  nextGun(): void {
    this.cycle(1);
  }
  prevGun(): void {
    this.cycle(-1);
  }

  // --- shooting ----------------------------------------------------------

  startShoot(): void {
    this.firing = true;
    this.tryShoot();
  }
  endShoot(): void {
    this.firing = false;
  }
  /** Whether the trigger is currently held (read by the net snapshot). */
  get isFiring(): boolean {
    return this.firing;
  }

  private tryShoot(): boolean {
    if (this.reloading || this.cooldown > 0) return false;
    if (this.curGun.curClip <= 0) {
      const dry = this.unit.getMuzzle();
      Sound.playAt("GunClick", dry.x, dry.y, 1, MECHANICAL_RANGE);
      this.startReload();
      return false;
    }

    // Hair Trigger (equips.rof, e.g. 0.8) shortens the between-shot cooldown.
    const baseDelay = this.curGun.fireDelay ?? 8;
    this.cooldown = baseDelay * (this.unit.equips?.rof || 1);
    // Sandbox / infinite-ammo matches never deplete the clip, so the weapon
    // fires forever and never has to reload.
    if (!SD.matchSettings.infiniteAmmo) this.curGun.curClip--;
    this.unit.score.addShot();

    // Fire sound. Beam weapons (zapper/beamer/flamethrower) re-fire every 1–2
    // frames; `soundFrames` throttles the fire-sound so it doesn't machine-gun
    // the mixer (Guns.as:375-381) — the crackle is one clip every N shots.
    const throttle = this.curGun.soundFrames ?? 0;
    const soundOk = throttle <= 1 || this.shotCount % throttle === 0;
    this.shotCount++;
    const fireSnd = soundOk ? this.curGun.fireSound : undefined;

    // Resolve the shot by raycast type (see weapons.ts RayType).
    // The shot leaves straight down the barrel: `Guns.as` never bends the aim,
    // it randomises inside a cone (`rand(-dynRecoil, dynRecoilMod)`, `:456-462`)
    // that a burst widens. So sustained fire still walks off-target, but
    // symmetrically — and the barrel keeps pointing where the bullet goes.
    // Stabilizer (equips.recoil, e.g. 0.6) tightens the cone.
    const heat = 1 + Math.min(1, this.recoilAmount) * (RECOIL_SPREAD_MAX - 1);
    const spread =
      this.curGun.recoil * 0.15 * (this.unit.equips?.recoil || 1) * heat;
    const aim = this.unit.aimRotation;
    this.lookAngle = aim;
    const tip = this.muzzleTip(aim);
    // The report comes from the barrel, not the chest. Held sideways at arm's
    // length that is a real offset, and it is what makes your own shots sit
    // slightly off-centre while an enemy's pan hard to their side.
    if (fireSnd) Sound.playAt(fireSnd, tip.x, tip.y, 1, GUNSHOT_RANGE);
    this.fireFeedback(aim);
    switch (this.curGun.rayType ?? "hitscan") {
      case "projectile": {
        const pellets = this.curGun.multiShot ?? 1;
        for (let p = 0; p < pellets; p++) {
          this.fireProjectile(aim + UT.rand(-spread, spread));
        }
        break;
      }
      case "spread": {
        // A cone of hitscan pellets from one trigger pull.
        const pellets = this.curGun.multiShot ?? 5;
        for (let p = 0; p < pellets; p++) {
          this.fireHitscan(aim + UT.rand(-spread * 3, spread * 3), false);
        }
        break;
      }
      case "beam":
        // A single piercing energy ray (thick tracer).
        this.fireHitscan(aim + UT.rand(-spread, spread), true);
        break;
      default: // "hitscan"
        this.fireHitscan(aim + UT.rand(-spread, spread), false);
        break;
    }
    if (this.curGun.curClip <= 0 && !this.curGun.oneClip) this.startReload();
    return true;
  }

  // --- feel: recoil / muzzle flash / smoke / casings / knockback ----------

  /**
   * Barrel tip in arena space for a shot leaving along `angleDeg`.
   *
   * Unit owns this calculation (shoulder pivot -> arm rotation -> barrel
   * length) so the shot, the muzzle flash and the arm art can never disagree.
   */
  private muzzleTip(angleDeg: number): { x: number; y: number } {
    return this.unit.getMuzzle(angleDeg);
  }

  /**
   * Everything a trigger pull does that isn't damage: muzzle flash at the
   * barrel, an ejected casing, a stoked smoke budget, the aim kick, and a
   * shove on the shooter for the heavy weapons.
   *
   * `angleDeg` is the direction the round actually left in.
   */
  private fireFeedback(angleDeg: number): void {
    const gun = this.curGun;
    const kick = kickOf(gun);
    const rad = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const tip = this.muzzleTip(angleDeg);
    const game = this.unit.game;

    // Muzzle flash: kept at every quality level, scaled by the weapon's punch.
    game.addMuzzleFlash?.(
      tip.x,
      tip.y,
      angleDeg,
      gun.muzzleColor ?? 0xffd86b,
      (gun.muzzleSize ?? 9) * (0.85 + kick * 0.3),
    );

    // Eject a casing sideways-and-back from the breech, tumbling.
    if (gun.shell) {
      game.addShell?.(
        tip.x - cos * 6,
        tip.y - sin * 6,
        -cos * UT.rand(0.8, 1.6) + UT.rand(-0.4, 0.4),
        -Math.abs(UT.rand(2.5, 4.5)),
      );
    }

    // Stoke the barrel: sustained fire on a chaingun/uzi keeps it smoking.
    this.smokeHeat = Math.min(6, this.smokeHeat + (gun.smoke ?? 0.4));

    // Stoke the cone. The gun's visible kick is its `_fire` animation band,
    // played by the arm; this is only the accuracy cost of firing fast.
    this.recoilAmount = Math.min(1.5, this.recoilAmount + kick);

    // Heavy weapons shove the shooter opposite the shot. This is a separate
    // impulse from `moving.vel`, so it never interrupts walking or braking.
    if (kick >= KNOCKBACK_MIN_KICK) {
      this.unit.addKnockback?.(-cos * kick * KNOCKBACK_PX);
    }
  }

  /** Drift a puff of smoke off the barrel tip; called for a few ticks after firing. */
  private emitSmokePuff(): void {
    const angle = this.unit.aimRotation;
    const rad = (angle * Math.PI) / 180;
    const tip = this.muzzleTip(angle);
    const size = 2 + (this.curGun.muzzleSize ?? 9) * 0.16;
    this.unit.game.addSmoke?.(
      tip.x + UT.rand(-2, 2),
      tip.y + UT.rand(-2, 2),
      size,
      Math.cos(rad) * 0.5 + UT.rand(-0.25, 0.25),
      Math.sin(rad) * 0.4 - UT.rand(0.3, 0.8),
    );
  }

  private fireProjectile(angleDeg: number): void {
    const m = this.unit.getMuzzle(angleDeg);
    const proj = new Projectile(this.unit.game, this.unit, this.curGun, m.x, m.y, angleDeg);
    this.unit.game.addFrameEffect(proj);
  }

  private fireHitscan(angleDeg: number, beam = false): void {
    const m = this.unit.getMuzzle(angleDeg);
    const rad = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    // Spiral Chamber (equips.range): weapons reach further (AS3 adds value*10).
    const range = this.curGun.maxRange + (this.unit.equips?.range ? this.unit.equips.range * 10 : 0);
    const arena = this.unit.game.arena;

    let hitX = m.x + cos * range;
    let hitY = m.y + sin * range;
    let hitAny = false;
    /** Did the ray terminate on geometry (as opposed to a body or thin air)? */
    let hitWall = false;
    /** Where the ray last drew blood, for the on-unit impact effect. */
    let unitHit: { x: number; y: number } | null = null;
    /** First unit hit — the seed for an arc-chain (railgun2). */
    let primaryTarget: any = null;
    // Kills from this single shot — 3 in one railgun blast earns "Knockout".
    let killsThisShot = 0;
    // A piercing ray must not damage the same unit at every 6px step.
    const alreadyHit = new Set<any>();
    // Zapper: linear damage falloff over range — 2× point-blank down to 0.5×
    // at max range (Bullet_Line_Zapper: (maxDist-curDist)/maxDist*1.5+0.5).
    const isZapper = this.curGun.tracerStyle === "zapper";

    for (let step = 0; step <= range; step += 6) {
      const px = m.x + cos * step;
      const py = m.y + sin * step;
      if (arena.pointInWall(px, py) || py >= arena.floorY) {
        hitX = px;
        hitY = py;
        hitWall = true;
        break;
      }
      let blocked = false;
      for (const u of this.unit.game.units) {
        if (u === this.unit || u.status.dead) continue;
        if (alreadyHit.has(u)) continue;
        if (!canHarm(this.unit, u)) continue;
        const hs = u.hitScan(px, py);
        if (hs.hit) {
          alreadyHit.add(u);
          const dmgMod = isZapper
            ? Math.max(0.5, ((range - step) / range) * 1.5 + 0.5)
            : 1;
          if (this.doHitUnit(u, px, py, cos, sin, hs, dmgMod)) killsThisShot++;
          hitAny = true;
          unitHit = { x: px, y: py };
          if (!primaryTarget) primaryTarget = u;
          if (!this.curGun.piercing) {
            blocked = true;
            hitX = px;
            hitY = py;
          }
          break;
        }
      }
      if (blocked) break;
    }

    // Arc-chain (railgun2 "Electro Bolt", extra.arc): the bolt jumps to up to 3
    // other nearby enemies at half damage, ignoring walls (doc 04 §2.0).
    if (this.curGun.arc && unitHit) {
      this.arcChain(unitHit.x, unitHit.y, primaryTarget, alreadyHit);
    }

    if (killsThisShot >= 3 && this.curGun.id === "railgun" && this.unit.human) {
      Achievements.addAch("railgun");
    }
    if (hitAny) this.unit.score.addHit();
    // Impact visuals, tinted per weapon (yellow bullet, cyan rail, purple
    // plasma, orange rocket): sparks where the ray bit geometry, the flesh
    // effect where it bit a body. A ray that expired in open air leaves
    // nothing behind — only the tracer sells it.
    if (hitWall && this.unit.human) {
      // Two of the walkthrough's steps are cleared by shooting a marked panel.
      const surf = arena.wallMask?.surfaceTypeAt(hitX, hitY);
      if (surf?.type === "tutWall") this.unit.game.tutorial?.shotWall(this.curGun.slot);
    }
    if (hitWall) {
      // Spray the sparks back off the surface — toward where the shot came from
      // (the muzzle), not a symmetric ring.
      const backDeg = (Math.atan2(m.y - hitY, m.x - hitX) * 180) / Math.PI;
      this.unit.game.addEffect(hitX, hitY, this.curGun.wallEff ?? "bullet", this.curGun.sparkColor, backDeg);
      // Secondary shower of embers arcing off the surface. The strike flash is
      // gone in four frames; this is what keeps the impact point readable.
      // Skipped for spread weapons — five pellets' worth at once is both a
      // waste of the effect budget and visually indistinct from the explosion
      // the shotgun already draws at each pellet's impact.
      if (this.curGun.rayType !== "spread") {
        this.unit.game.addSparkRain?.(hitX, hitY, this.curGun.sparkColor);
      }
    }
    if (unitHit) {
      // Blood keeps its own (victim) tint — don't stain it with the weapon's
      // spark colour; energy impacts (plasma/lightning) do take the tint.
      const eff = this.curGun.unitEff ?? "blood";
      const isBlood = eff === "blood" || eff === "bloodBig";
      this.unit.game.addEffect(
        unitHit.x,
        unitHit.y,
        eff,
        isBlood ? undefined : this.curGun.sparkColor,
      );
    }
    this.unit.game.addTracer(m.x, m.y, hitX, hitY, this.tracerOpts(beam, !!unitHit));
  }

  /**
   * Tracer draw options for the current gun (colour/width/style/dashing),
   * mirroring the weapon's Bullet_Line_* params (doc 05 §4). `beam` weapons
   * whose style wasn't authored still get a sane thick-energy fallback.
   */
  private tracerOpts(beam: boolean, hitUnit: boolean): TracerOpts {
    const g = this.curGun;
    const style: TracerStyle = g.tracerStyle ?? (beam ? "effect" : "basic");
    return {
      style,
      hitUnit,
      color: g.tracerColor ?? (beam ? 0x66ccff : 0xfff2a0),
      color2: g.tracerColor2 ?? g.tracerColor ?? (beam ? 0xeaffff : 0xfff2a0),
      w1: g.tracerW1,
      w2: g.tracerW2,
      a1: g.tracerAlpha1,
      a2: g.tracerAlpha2,
      dashed: g.tracerDashed ?? (style === "basic"),
    };
  }

  /**
   * Electro-Bolt arc: from the impact point, find up to 3 living, harmable
   * enemies within `arc` px (through walls — the original `stats.extra.arc`
   * scan ignores geometry), deal 50% damage, and draw an electric tracer to
   * each. Ported from Bullet.doHitEffect's arc branch (doc 04 §2.0).
   */
  private arcChain(x: number, y: number, seed: any, exclude: Set<any>): void {
    const radius = this.curGun.arc ?? 400;
    const targets: any[] = [];
    for (const u of this.unit.game.units) {
      if (u === this.unit || u === seed || u.status.dead) continue;
      if (exclude.has(u)) continue;
      if (!canHarm(this.unit, u)) continue;
      const ty = u.y - 40;
      if (UT.getDist(x, y, u.x, ty) <= radius) targets.push(u);
      if (targets.length >= 3) break;
    }
    for (const u of targets) {
      const ty = u.y - 40;
      const ang = UT.getRotation(x, y, u.x, ty);
      const rad = (ang * Math.PI) / 180;
      this.doHitUnit(u, u.x, ty, Math.cos(rad), Math.sin(rad), { head: false, low: false }, 0.5);
      this.unit.game.addTracer(x, y, u.x, ty, {
        style: "electric",
        color: this.curGun.tracerColor ?? 0x00ccff,
        color2: this.curGun.tracerColor2 ?? 0xccffff,
        hitUnit: true,
      });
    }
  }

  /** Apply one hit. Returns true when the blow killed the target. */
  private doHitUnit(
    target: any,
    hx: number,
    hy: number,
    cos: number,
    sin: number,
    hs: { head: boolean; low: boolean } = { head: false, low: false },
    dmgMod = 1,
  ): boolean {
    // Resolve the hit region → Raze 2 locational crit multiplier. The low band
    // is a butt shot when the round travels the way the target faces (it came
    // from behind), a crotch shot when it comes at their front.
    let region: "head" | "crotch" | "butt" | "body" = "body";
    let mult = 1;
    if (hs.head) {
      region = "head";
      mult = this.curGun.headMult ?? 1;
    } else if (hs.low) {
      const behind = Math.sign(cos) === Math.sign(target.facing ?? 1);
      region = behind ? "butt" : "crotch";
      mult = (behind ? this.curGun.buttMult : this.curGun.crotchMult) ?? 1;
    }
    // Armor Plating (target.equips.critdef): immune to locational crits — the
    // multiplier is cancelled and the hit no longer counts as a headshot.
    const critImmune = !!target.equips?.critdef;
    if (critImmune) { mult = 1; region = "body"; }
    const headShot = region === "head";
    // Target Marker (attacker equips.critical): extra damage on a landed crit.
    const critBonus = mult > 1 && this.unit.equips?.critical ? this.unit.equips.critical : 1;
    const dmg = this.curGun.damage * mult * critBonus * dmgMod
      * (this.unit.status?.damageMult ?? 1)
      * (Number(SD.matchSettings.dmgMod) || 1);
    // Ignite the target if this weapon sets fire (Fire+/flamethrower). The
    // burn DoT lives in Status/Unit (out of this wave's ownership); call it
    // through optionally so it is a graceful no-op until that system lands.
    // Armor Plating (target.equips.critdef) also makes the wearer fireproof
    // (Status.as:236 gates setFire by `!unit.equips.critdef`).
    if (this.curGun.setFire && !target.equips?.critdef) {
      target.status.setFire?.(this.curGun.setFire, this.unit);
    }
    if (headShot) {
      // At the wound, not the target's feet — the pan should match the spray.
      Sound.playAt(
        HEADSHOT_SOUNDS[Math.floor(Math.random() * 3)],
        hx,
        hy,
        1,
        HEADSHOT_RANGE,
      );
      // Critical-hit pop, right where the round landed. Louder than any weapon
      // impact so it survives being drawn over by the blood spray.
      this.unit.game.addEffect(hx, hy, "crit");
    } else if (mult > 1) {
      // Crotch/butt crit — same pop, no headshot sound.
      this.unit.game.addEffect(hx, hy, "crit");
    }
    if (this.curGun.percAmmo && this.curGun.curAmmo > 0) this.curGun.curAmmo--;
    return target.status.doDamage(dmg, {
      attacker: this.unit,
      x: cos,
      y: sin,
      headShot,
      region,
    });
  }

  // --- reload ------------------------------------------------------------

  startReload(): void {
    if (this.reloading || this.curGun.oneClip) return;
    if (this.curGun.curClip >= this.curGun.maxClip) return;
    if (this.curGun.curAmmo <= 0 && !this.curGun.infAmmo && !SD.matchSettings.infiniteClips) {
      // Out of ammo entirely — switch to another owned weapon.
      this.nextGun();
      return;
    }
    this.reloading = true;
    // Per-weapon reload length, driven by the arm-rig silhouette (pistol fast,
    // rocket slow) — replaces the old flat 40-frame reload for every gun.
    this.reloadLen = this.curGun.reloadFrames ?? RELOAD_FRAMES;
    this.reloadTimer = this.reloadLen;
    // A fresh clip means a cool barrel: drop any pending smoke.
    this.smokeHeat = 0;
    const snd = this.curGun.reloadSound;
    // Reload noise happens at the hands, and only carries across a room.
    if (snd) {
      const h = this.unit.getShoulder();
      Sound.playAt(snd, h.x, h.y, 1, MECHANICAL_RANGE);
    }
    this.ejectMagazine();
  }

  /**
   * Drop the spent magazine out of the weapon at the start of a reload.
   *
   * Reuses the shell-casing effect: a magazine is just a heavier, slower piece
   * of tumbling debris, so it falls more or less straight down from the breech
   * rather than being flung sideways like an ejected case.
   */
  private ejectMagazine(): void {
    if (!this.curGun.shell) return;
    const angle = this.unit.aimRotation;
    const tip = this.muzzleTip(angle);
    const rad = (angle * Math.PI) / 180;
    // Back down the barrel from the tip: roughly where the breech sits.
    this.unit.game.addShell?.(
      tip.x - Math.cos(rad) * 10,
      tip.y - Math.sin(rad) * 10,
      UT.rand(-0.5, 0.5),
      UT.rand(0.4, 1.2),
    );
  }

  private endReload(): void {
    const need = this.curGun.maxClip - this.curGun.curClip;
    // "Infinite Clips" (doc 11 §2.1): the reload refills the magazine without
    // drawing down the reserve pool — you still reload, but never run dry.
    if (this.curGun.infAmmo || SD.matchSettings.infiniteClips) {
      this.curGun.curClip = this.curGun.maxClip;
    } else {
      const take = Math.min(need, this.curGun.curAmmo);
      this.curGun.curClip += take;
      this.curGun.curAmmo -= take;
    }
    this.reloading = false;
    const snd = RELOAD_END_SOUND[this.curGun.reloadRig ?? "rifle"];
    if (snd) {
      const h = this.unit.getShoulder();
      Sound.playAt(snd, h.x, h.y, 1, MECHANICAL_RANGE);
    }
  }

  /** For AI: is there line of sight to `target` within this weapon's range? */
  checkUnitHit(target: any): boolean {
    const m = this.unit.getMuzzle();
    const dist = UT.getDist(m.x, m.y, target.x, target.y - 45);
    if (dist > this.curGun.maxRange) return false;
    const ang = UT.getRotation(m.x, m.y, target.x, target.y - 45);
    const rad = (ang * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    for (let step = 0; step <= dist; step += 8) {
      const px = m.x + cos * step;
      const py = m.y + sin * step;
      if (this.unit.game.arena.pointInWall(px, py)) return false;
    }
    return true;
  }

  enterFrame(): void {
    if (this.cooldown > 0) this.cooldown--;

    // The cone tightens back exponentially (~0.2s to settle), as `dynRecoil`
    // bleeds down toward the weapon's base recoil in `Guns.as:202-204`.
    this.recoilAmount *= RECOIL_DECAY;
    if (this.recoilAmount < 0.001) this.recoilAmount = 0;
    this.lookAngle = this.unit.aimRotation;

    // Barrel smoke: puffs trail out of a hot barrel for a few ticks after
    // firing. Decorative, so the whole emitter is off on the Low profile.
    if (this.smokeHeat > 0) {
      if (Quality.detail) {
        if (--this.smokeTimer <= 0) {
          this.smokeTimer = SMOKE_INTERVAL;
          this.emitSmokePuff();
          this.smokeHeat -= 1;
        }
      }
      // Bleed off leftover fractional heat so a single light shot still cools.
      this.smokeHeat = Math.max(0, this.smokeHeat - 0.03);
    } else {
      this.smokeTimer = 0;
    }

    if (this.reloading) {
      this.reloadTimer--;
      // Linear 0..1 progress through the reload — Unit maps this onto the
      // weapon's authentic reload frame range.
      this.reloadProgress = 1 - this.reloadTimer / this.reloadLen;
      // Fallback swing for weapons that have no reload animation frames.
      this.reloadAngle = Math.sin(this.reloadProgress * Math.PI) * 1.1;
      if (this.reloadTimer <= 0) this.endReload();
    } else {
      this.reloadAngle = 0;
      this.reloadProgress = 0;
    }
    // Sustained fire for auto weapons.
    if (this.firing && this.curGun.autoFire && !this.reloading && this.cooldown === 0) {
      this.tryShoot();
    }
  }
}
