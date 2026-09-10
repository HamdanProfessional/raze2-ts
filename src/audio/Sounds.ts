import { SD } from "../state/SD";
import { ASSET_BASE, GAME_HEIGHT, GAME_WIDTH } from "../core/Config";

/**
 * Audio system. Ported from SoundHandler.as onto the Web Audio API.
 *
 * The original SWF attenuated volume by distance from the *arena centre* and
 * panned by horizontal offset, because the Flash build had no camera — the
 * whole arena was always on screen, so the screen centre was the listener.
 *
 * This port scrolls a camera that follows the player, so the arena centre is
 * the wrong reference: a shot fired next to you sounded identical to one on
 * the far side of the map. World sounds are therefore spatialised against a
 * *listener* position (`setListener`, driven from the player each frame) by
 * `playAt` / `playSynthAt`.
 *
 * Music loops via a dedicated gain node. Respects SD.sound / SD.music.
 *
 * All clips are the sound files extracted from the original SWF, served from
 * public/assets/sounds. Keys are the logical names used throughout the game.
 */

// key -> filename (extracted SWF audio, numeric prefixes preserved).
//
// Canonical keys are the Raze 2 effects (R2_* prefix, mirroring the R2_ music
// convention below). Legacy Raze 1 keys that gameplay call sites still pass to
// Sound.play(...) are mapped onto these R2 assets through ALIASES (see below),
// so no call site has to change to hear the authentic Raze 2 audio.
const MANIFEST: Record<string, string> = {
  // --- Raze 2 weapon fire (2114-2145 / 35 range) ---
  R2_pistolFire: "r2_2133_S_pistolFire.mp3",
  R2_shotgunFire: "r2_2140_S_shotgunFire.mp3",
  R2_assaultFire: "r2_2120_S_assaultFire.mp3",
  R2_uziFire: "r2_2144_S_uziFire.mp3",
  R2_sniperFire: "r2_2142_S_sniperFire.mp3",
  R2_alienSniper: "r2_2118_S_alienSniper.mp3",
  R2_plasmaFire: "r2_2121_S_plasmaFire.mp3",
  R2_ripperFire: "r2_2126_S_ripperFire.mp3",
  R2_rocketFire: "r2_35_S_rocketFire.mp3",
  R2_laserBig: "r2_2131_S_laserBig.mp3",
  R2_Whip: "r2_41_S_Whip.mp3",
  // --- Raze 2 reloads ---
  R2_reloadPistol: "r2_2127_S_reloadPistol.mp3",
  R2_reloadRifle: "r2_2119_S_reloadRifle.mp3",
  R2_reloadShotgun: "r2_2139_S_reloadShotgun.mp3",
  R2_reloadSniper: "r2_2141_S_reloadSniper.mp3",
  R2_reloadHeavy: "r2_2122_S_reloadHeavy.mp3",
  R2_reloadRocket: "r2_2134_S_reloadRocket.mp3",
  // --- Raze 2 impacts / feedback ---
  R2_rocketExplode: "r2_2125_S_rocketExplode.mp3",
  R2_GunClick: "r2_2123_S_GunClick.mp3",
  R2_Headshot1: "r2_2128_S_Headshot1.mp3",
  R2_Headshot2: "r2_2129_S_Headshot2.mp3",
  R2_Headshot3: "r2_2130_S_Headshot3.mp3",
  R2_Medal: "r2_39_S_Medal.mp3",
  // --- Raze 2 pickups / abilities ---
  R2_Heal: "r2_2136_S_Heal.mp3",
  R2_Powerup: "r2_2137_S_Powerup.mp3",
  R2_Static: "r2_2143_S_Static.mp3",
  R2_Jumppad: "r2_2138_S_Jumppad.mp3",
  R2_Equip: "r2_2116_S_Equip.mp3",
  // --- Raze 2 UI stingers (the five formerly collapsed into "Beep") ---
  R2_Click: "r2_2117_S_Click.mp3",
  R2_ClickGo: "r2_2115_S_ClickGo.mp3",
  R2_ClickBack: "r2_40_S_ClickBack.mp3",
  R2_Error: "r2_2124_S_Error.mp3",
  // --- Raze 2 misc / Easter egg / unused-in-original assets (kept for parity) ---
  R2_CamelJizz: "r2_36_S_CamelJizz.mp3",
  R2_Laser: "r2_2132_S_Laser.mp3",
  R2_Fire: "r2_2135_S_Fire.mp3",
  R2_Zapper: "r2_2145_S_Zapper.mp3",

  // --- Raze 1 assets with no Raze 2 equivalent, still used as port inventions
  // (reload "bookend" slides/bolts, wind-down spin, boss fire ambience). ---
  Assault_Slide: "190_Assault_Slide.mp3",
  Assault_Clipout: "193_Assault_Clipout.mp3",
  ShotgunShell: "189_S_ShotgunShell.mp3",
  winddown: "169_S_winddown.mp3",
  nadeClipout: "167_S_nadeClipout.mp3",
  BossFire: "176_S_BossFire.mp3",
  Pull: "168_S_Pull.mp3",
  SGClip: "188_SGClip.mp3",
  // music
  M_Menu: "199_M_Menu.mp3",
  M_Boss: "1_M_Boss.mp3",
  M_Baby: "195_M_Baby.mp3",
  M_Crowd: "196_M_Crowd.mp3",
  M_Acid: "197_M_Acid.mp3",
  M_Dnb: "198_M_Dnb.mp3",
  M_Protos: "200_M_Protos.mp3",
  M_Rocket: "2_M_Rocket.mp3",
  // Raze 2 soundtrack (extracted from raze-2.swf). Two menu loops + eight
  // in-match tracks. See MATCH_MUSIC / menu setMusic("M_Menu").
  R2_Menu: "r2_2114_M_Menu.mp3",
  R2_MenuIntro: "r2_37_M_MenuIntro.mp3",
  R2_Necro: "r2_28_M_Necro.mp3",
  R2_Rose: "r2_29_M_Rose.mp3",
  R2_Ricochet: "r2_30_M_Ricochet.mp3",
  R2_Infernal: "r2_31_M_Infernal.mp3",
  R2_Theloop: "r2_32_M_Theloop.mp3",
  R2_Throwdown: "r2_33_M_Throwdown.mp3",
  R2_Rocket: "r2_34_M_Rocket.mp3",
  R2_Warhead: "r2_38_M_Warhead.mp3",
};

/**
 * Play-id aliases: logical name a call site passes to Sound.play/playAt ->
 * canonical MANIFEST key. This is how the Raze 2 assets get wired to their
 * triggers *without* editing any call site (this file is the only one this
 * wave owns). Every legacy Raze 1 key that maps onto a genuine Raze 2 sound is
 * redirected here; keys absent from this map resolve straight to MANIFEST.
 *
 * Weapon->sound mapping cross-referenced from docs/raze2/15-audio-music.md §1
 * and the port's per-weapon FIRE_SOUND / RELOAD_SOUND maps (Guns.ts):
 *   pistol->pistolFire, rifle/precision-laser->assaultFire, uzi->uziFire,
 *   shotgun/terminator/particle->shotgunFire, sniper->sniperFire,
 *   railgun/pulsator->alienSniper, plasma/torch/bouncer->plasmaFire,
 *   shredder(chaingun)->ripperFire, rocket/ice->rocketFire, grenade->Whip.
 */
const ALIASES: Record<string, string> = {
  // Weapon fire (legacy Raze 1 fire key -> Raze 2 fire asset)
  PistolFire: "R2_pistolFire",
  Arifle2: "R2_assaultFire",
  ShotgunFire: "R2_shotgunFire",
  Uzi1: "R2_uziFire",
  Uzi2: "R2_uziFire",
  SniperFire: "R2_sniperFire",
  Lightning: "R2_alienSniper",
  Zapper: "R2_plasmaFire",
  Chainfire: "R2_ripperFire",
  Rocket: "R2_rocketFire",
  Nadeout: "R2_Whip", // grenade-throw whoosh cue
  // Reloads (start-of-reload magazine seat -> per-class Raze 2 reload)
  PistolReload: "R2_reloadPistol",
  Assault_Clipin: "R2_reloadRifle", // rifle + uzi
  ShotgunPump: "R2_reloadShotgun",
  RailReload: "R2_reloadSniper", // sniper + railgun
  windup: "R2_reloadHeavy", // chaingun/shredder spin-up
  nadeClipin: "R2_reloadRocket", // grenade + rocket
  // Impacts / feedback
  rocketexplode: "R2_rocketExplode",
  explodenade: "R2_rocketExplode", // R2 uses one detonation sound for both
  GunClick: "R2_GunClick", // dry-fire / out-of-ammo
  Headshot1: "R2_Headshot1",
  Headshot2: "R2_Headshot2",
  Headshot3: "R2_Headshot3",
  Medal: "R2_Medal",
  // UI: the generic "Beep" every menu currently plays becomes the authentic
  // Raze 2 select click. The distinct confirm/back/equip/error stingers are in
  // the MANIFEST as R2_ClickGo / R2_ClickBack / R2_Equip / R2_Error for call
  // sites to adopt (kept split rather than re-collapsed).
  Beep: "R2_Click",
  // Semantic linkage names (original S_* class names), in case a call site
  // prefers the authentic name over the port's legacy key.
  S_Click: "R2_Click",
  S_ClickGo: "R2_ClickGo",
  S_ClickBack: "R2_ClickBack",
  S_Equip: "R2_Equip",
  S_Error: "R2_Error",
  S_Heal: "R2_Heal",
  S_Powerup: "R2_Powerup",
  S_Static: "R2_Static",
  S_Jumppad: "R2_Jumppad",
  S_Medal: "R2_Medal",
  S_Whip: "R2_Whip",
  S_laserBig: "R2_laserBig",
};

/** Resolve a play-id / manifest alias to its canonical MANIFEST key. */
function resolveKey(key: string): string {
  return ALIASES[key] ?? key;
}

/** In-game music tracks chosen at random per match — the Raze 2 soundtrack. */
export const MATCH_MUSIC = [
  "R2_Necro", "R2_Rose", "R2_Ricochet", "R2_Infernal",
  "R2_Theloop", "R2_Throwdown", "R2_Rocket", "R2_Warhead",
];

/**
 * Short one-shots the original SWF never shipped a clip for — footsteps, jump
 * landings, the respawn whoosh, the end-of-match chord. They are synthesized
 * from noise and oscillators rather than added as assets: each is well under a
 * kilobyte of code, they pitch/pan for free, and nothing has to be downloaded.
 */
export type SynthKind = "step" | "land" | "whoosh" | "fanfare";

/**
 * Per-level arena ambience. `hum` is the low bed, `air` the amount of
 * wind/noise over it, and `buzz` an optional mains-hum tone (the toxic level's
 * failing electrics). All levels get *something* so the arena never sounds
 * dead between shots.
 */
interface AmbienceProfile {
  hum: number;
  air: number;
  buzz: number;
  /** Low-pass corner for the noise bed, Hz. Lower = more distant rumble. */
  cutoff: number;
}

const AMBIENCE: Record<string, AmbienceProfile> = {
  // Open city rooftops: wind is the dominant voice.
  city: { hum: 55, air: 0.05, buzz: 0, cutoff: 700 },
  // Sealed station: ventilation drone, almost no wind.
  space: { hum: 44, air: 0.02, buzz: 0, cutoff: 260 },
  // Failing chemical plant: heavy low rumble plus a mains buzz.
  toxic: { hum: 48, air: 0.035, buzz: 0.012, cutoff: 420 },
  // Underground pit: deep, close, muffled.
  pit: { hum: 38, air: 0.03, buzz: 0, cutoff: 200 },
};
const AMBIENCE_DEFAULT: AmbienceProfile = { hum: 50, air: 0.03, buzz: 0, cutoff: 500 };

/** Seconds the ambience bed takes to fade in / out, so it never pops. */
const AMBIENCE_RAMP = 1.5;

// --- spatialisation tuning -------------------------------------------------

/**
 * Default hearing radius in arena pixels. Beyond this a world sound is not
 * played at all: the arena is up to ~2000px wide, and a pistol shot from the
 * far corner arriving at a token volume is just mud in the mix.
 *
 * Individual calls override it — footsteps carry far less than a rocket.
 */
export const DEFAULT_RANGE = 950;

/**
 * Inside this radius a sound is at full volume and (mostly) centred: it is
 * "on top of" the listener, so neither falloff nor panning should bite yet.
 */
const NEAR_RADIUS = 110;

/**
 * How far off-axis a source must be for a hard left/right pan. Deliberately
 * much smaller than the screen so that off-screen shots pan fully, which is
 * the cue that tells you which side you are being flanked from.
 */
const PAN_WIDTH = 420;

/**
 * Falloff curve exponent. 1 is linear; >1 keeps nearby sounds loud and drops
 * distant ones away faster, which reads closer to inverse-square without ever
 * spiking to infinity at zero distance.
 */
const FALLOFF_EXP = 1.7;

/** Volume + pan for a world sound, or null when it is out of earshot. */
export interface Spatial {
  volume: number;
  pan: number;
}

class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();

  private musicSrc: AudioBufferSourceNode | null = null;
  private currentMusic = "";
  private loaded = false;

  /**
   * Listener position in arena space — where the player's ears are. Defaults
   * to the screen centre so sounds played outside a match (or before the first
   * camera update) are still audible and centred.
   */
  private listenerX = GAME_WIDTH / 2;
  private listenerY = GAME_HEIGHT / 2;

  /** Shared white-noise buffer for every synthesized voice (built on demand). */
  private noiseBuf: AudioBuffer | null = null;
  /** Ambient bed: the mixer node plus the voices feeding it. */
  private ambienceBus: GainNode | null = null;
  private ambienceNodes: AudioScheduledSourceNode[] = [];
  private currentAmbience = "";

  /** Lazily create the context (must follow a user gesture in most browsers). */
  private ensureCtx(): AudioContext | null {
    if (typeof AudioContext === "undefined") return null; // headless / SSR
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.4;
      this.musicGain.connect(this.master);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  /** Preload every clip. Call from the Loader screen. */
  async loadAll(onProgress?: (done: number, total: number) => void): Promise<void> {
    if (this.loaded) return;
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const keys = Object.keys(MANIFEST);
    let done = 0;
    await Promise.all(
      keys.map(async (key) => {
        try {
          const res = await fetch(`${ASSET_BASE}/sounds/${MANIFEST[key]}`);
          const arr = await res.arrayBuffer();
          this.buffers.set(key, await ctx.decodeAudioData(arr));
        } catch {
          /* a missing/undecodable clip is non-fatal */
        } finally {
          onProgress?.(++done, keys.length);
        }
      }),
    );
    this.loaded = true;
  }

  /** Resume the context on a user gesture (call from click/keydown). */
  resume(): void {
    this.ensureCtx();
  }

  play(key: string, volume = 1, pan = 0): void {
    if (!SD.sound || !this.ctx || !this.master) return;
    const buf = this.buffers.get(resolveKey(key));
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(panner).connect(gain).connect(this.master);
    src.start();
  }

  // --- spatialisation -----------------------------------------------------

  /**
   * Move the listener (arena space). GameScreen drives this from the player
   * every frame, so world sounds are heard from where the player is standing
   * rather than from a fixed point on the map.
   */
  setListener(x: number, y: number): void {
    this.listenerX = x;
    this.listenerY = y;
  }

  /** Current listener position, for callers that want to pre-cull by distance. */
  getListener(): { x: number; y: number } {
    return { x: this.listenerX, y: this.listenerY };
  }

  /**
   * Volume falloff and stereo pan for a source at (x, y), or null when it is
   * further than `maxRange` and should not be played at all.
   *
   * Distance is measured in 2D, but the vertical axis is weighted down: arenas
   * are far wider than they are tall, and a shot one floor up should not read
   * as further away than one the same number of pixels down the corridor.
   */
  spatial(x: number, y: number, maxRange = DEFAULT_RANGE): Spatial | null {
    const dx = x - this.listenerX;
    const dy = (y - this.listenerY) * 0.7;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist >= maxRange) return null;

    let volume: number;
    if (dist <= NEAR_RADIUS) {
      volume = 1;
    } else {
      const t = (dist - NEAR_RADIUS) / Math.max(1, maxRange - NEAR_RADIUS);
      volume = Math.pow(1 - t, FALLOFF_EXP);
    }

    // Pan by horizontal offset, but fade the panning out as the source
    // approaches the listener — a sound at your own feet has no side.
    const spread = Math.min(1, dist / NEAR_RADIUS);
    const pan = Math.max(-1, Math.min(1, dx / PAN_WIDTH)) * spread;

    return { volume, pan };
  }

  /**
   * Play a clip positioned in the arena: attenuated by distance to the
   * listener, panned by horizontal offset, and skipped entirely when out of
   * earshot. This is the entry point for every world sound (gunfire, impacts,
   * explosions, reloads); `play()` is for UI, which has no position.
   *
   * `volume` scales the result, so a quiet sound stays quiet up close.
   */
  playAt(key: string, x: number, y: number, volume = 1, maxRange = DEFAULT_RANGE): void {
    if (!SD.sound) return;
    const s = this.spatial(x, y, maxRange);
    if (!s) return;
    this.play(key, volume * s.volume, s.pan);
  }

  /**
   * Back-compat name for the SoundHandler.playDistantSound port. Identical to
   * playAt() — kept so older call sites keep compiling.
   *
   * @deprecated Use playAt().
   */
  playDistant(key: string, x: number, y: number): void {
    this.playAt(key, x, y);
  }

  /** Loop a music track, replacing any current one. */
  setMusic(key: string): void {
    if (!SD.music) return;
    if (this.currentMusic === key) return;
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const buf = this.buffers.get(resolveKey(key));
    if (!buf || !this.musicGain) return;
    this.stopMusic();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.musicGain);
    src.start();
    this.musicSrc = src;
    this.currentMusic = key;
  }

  stopMusic(): void {
    if (this.musicSrc) {
      try {
        this.musicSrc.stop();
      } catch {
        /* already stopped */
      }
      this.musicSrc = null;
    }
    this.currentMusic = "";
  }

  // --- synthesized one-shots ---------------------------------------------

  /** A second of white noise, built once and reused by every noise voice. */
  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noiseBuf) {
      const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    }
    return this.noiseBuf;
  }

  /**
   * Play one of the synthesized one-shots at `volume` (0..1) and `pan` (-1..1).
   * Safe to call at any time: it is a no-op without an audio context or with
   * sound switched off.
   */
  playSynth(kind: SynthKind, volume = 1, pan = 0): void {
    if (!SD.sound) return;
    // Deliberately does not create the context (unlike setAmbience): these are
    // incidental sounds and must never be the thing that spins up audio before
    // the player has interacted with the page.
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;

    const out = ctx.createGain();
    out.gain.value = Math.max(0, Math.min(1, volume));
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(panner).connect(this.master);

    switch (kind) {
      case "step":
      case "land": {
        const heavy = kind === "land";
        // Body of the sound: a very short band-passed noise burst — the scuff.
        const dur = heavy ? 0.16 : 0.07;
        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer(ctx);
        noise.loop = true;
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = heavy ? 320 : 900;
        bp.Q.value = 0.8;
        const nEnv = ctx.createGain();
        nEnv.gain.setValueAtTime(heavy ? 0.9 : 0.55, now);
        nEnv.gain.exponentialRampToValueAtTime(0.001, now + dur);
        noise.connect(bp).connect(nEnv).connect(out);
        noise.start(now);
        noise.stop(now + dur);

        // Thump underneath: a fast downward sine sweep gives it weight.
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(heavy ? 150 : 190, now);
        osc.frequency.exponentialRampToValueAtTime(heavy ? 45 : 80, now + dur);
        const oEnv = ctx.createGain();
        oEnv.gain.setValueAtTime(heavy ? 0.8 : 0.3, now);
        oEnv.gain.exponentialRampToValueAtTime(0.001, now + dur);
        osc.connect(oEnv).connect(out);
        osc.start(now);
        osc.stop(now + dur);
        break;
      }
      case "whoosh": {
        // Noise swept up through a band-pass: teleport-in / respawn.
        const dur = 0.45;
        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer(ctx);
        noise.loop = true;
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.Q.value = 3;
        bp.frequency.setValueAtTime(300, now);
        bp.frequency.exponentialRampToValueAtTime(2600, now + dur);
        const env = ctx.createGain();
        env.gain.setValueAtTime(0.001, now);
        env.gain.exponentialRampToValueAtTime(0.6, now + dur * 0.35);
        env.gain.exponentialRampToValueAtTime(0.001, now + dur);
        noise.connect(bp).connect(env).connect(out);
        noise.start(now);
        noise.stop(now + dur);
        break;
      }
      case "fanfare": {
        // A rising major triad — the "match over" chord.
        const dur = 1.5;
        const notes = [392, 494, 587, 784]; // G4 B4 D5 G5
        notes.forEach((freq, i) => {
          const start = now + i * 0.11;
          const osc = ctx.createOscillator();
          osc.type = "triangle";
          osc.frequency.value = freq;
          const env = ctx.createGain();
          env.gain.setValueAtTime(0.001, start);
          env.gain.exponentialRampToValueAtTime(0.28, start + 0.03);
          env.gain.exponentialRampToValueAtTime(0.001, now + dur);
          osc.connect(env).connect(out);
          osc.start(start);
          osc.stop(now + dur);
        });
        break;
      }
    }
  }

  /** Distance-attenuated, panned synth one-shot (mirrors playAt). */
  playSynthAt(
    kind: SynthKind,
    x: number,
    y: number,
    volume = 1,
    maxRange = DEFAULT_RANGE,
  ): void {
    if (!SD.sound) return;
    const s = this.spatial(x, y, maxRange);
    if (!s) return;
    this.playSynth(kind, volume * s.volume, s.pan);
  }

  // --- arena ambience -----------------------------------------------------

  /**
   * Start (or switch to) the ambient bed for a level. Cross-fades: the old bed
   * ramps down and is torn down, the new one ramps up over AMBIENCE_RAMP.
   * Calling it with the level already playing is a no-op.
   */
  setAmbience(levelId: string): void {
    if (this.currentAmbience === levelId) return;
    this.stopAmbience();
    if (!SD.sound) return;
    const ctx = this.ensureCtx();
    if (!ctx || !this.master) return;

    const p = AMBIENCE[levelId] ?? AMBIENCE_DEFAULT;
    const now = ctx.currentTime;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, now);
    bus.gain.linearRampToValueAtTime(1, now + AMBIENCE_RAMP);
    bus.connect(this.master);

    const nodes: AudioScheduledSourceNode[] = [];

    // Wind / room tone: looping noise through a low-pass.
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(ctx);
    noise.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = p.cutoff;
    const airGain = ctx.createGain();
    airGain.gain.value = p.air;
    noise.connect(lp).connect(airGain).connect(bus);
    noise.start(now);
    nodes.push(noise);

    // Low drone, detuned against itself so it slowly beats instead of sitting
    // as a dead sine.
    for (const detune of [0, 4]) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = p.hum;
      osc.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = 0.035;
      osc.connect(g).connect(bus);
      osc.start(now);
      nodes.push(osc);
    }

    // Failing electrics: a quiet 50Hz-ish buzz with its harmonic.
    if (p.buzz > 0) {
      for (const [freq, amp] of [[50, 1], [150, 0.45]] as const) {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.value = p.buzz * amp;
        osc.connect(g).connect(bus);
        osc.start(now);
        nodes.push(osc);
      }
    }

    this.ambienceBus = bus;
    this.ambienceNodes = nodes;
    this.currentAmbience = levelId;
  }

  /** Fade the ambient bed out and tear its voices down. */
  stopAmbience(): void {
    const bus = this.ambienceBus;
    const nodes = this.ambienceNodes;
    this.ambienceBus = null;
    this.ambienceNodes = [];
    this.currentAmbience = "";
    if (!bus || !this.ctx) return;
    const now = this.ctx.currentTime;
    const fade = 0.4;
    try {
      bus.gain.cancelScheduledValues(now);
      bus.gain.setValueAtTime(bus.gain.value, now);
      bus.gain.linearRampToValueAtTime(0.0001, now + fade);
    } catch {
      /* context torn down */
    }
    for (const n of nodes) {
      try {
        n.stop(now + fade);
      } catch {
        /* already stopped */
      }
    }
  }
}

export const Sound = new SoundManager();
