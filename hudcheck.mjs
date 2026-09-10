// test/pixi-stub.mjs
var Node = class {
  constructor() {
    this.children = [];
    this.x = 0;
    this.y = 0;
    this.rotation = 0;
    this.alpha = 1;
    this.visible = true;
    this.scale = { x: 1, y: 1, set(x, y) {
      this.x = x;
      this.y = y ?? x;
    } };
    this.position = { set: (x, y) => {
      this.x = x;
      this.y = y;
    } };
    this.anchor = { set() {
    } };
  }
  addChild(...c) {
    this.children.push(...c);
    return c[0];
  }
  removeChild(c) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    return c;
  }
  destroy() {
  }
  clear() {
    return this;
  }
  rect() {
    return this;
  }
  circle() {
    return this;
  }
  moveTo() {
    return this;
  }
  lineTo() {
    return this;
  }
  fill() {
    return this;
  }
  stroke() {
    return this;
  }
};
var Container = class extends Node {
  addChildAt(c) {
    this.children.unshift(c);
    return c;
  }
};
var Graphics = class extends Node {
};
var Text = class extends Node {
  constructor(o = {}) {
    super();
    this.text = o.text ?? "";
    this.style = o.style;
  }
};
var TextStyle = class {
  constructor(o = {}) {
    Object.assign(this, o);
  }
};

// src/core/Config.ts
var GAME_WIDTH = 700;
var FPS = 30;
var MS_PER_FRAME = 1e3 / FPS;
var ASSET_BASE = "assets";

// src/game/weapons.ts
var GUN_ORDER = [
  "pistol",
  "uzi",
  "rifle",
  "plasma",
  "shotgun",
  "sniper",
  "railgun",
  "grenade",
  "chaingun",
  "rocket"
];

// src/state/Log.ts
var DEBUG = false;
function trace(label, ...args) {
  if (DEBUG) console.debug(`[Log] ${label}`, ...args);
}
var Log = {
  View(id = 0, guid = "", url = "", flag = false) {
    trace("View", id, guid, url, flag);
  },
  Play() {
    trace("Play");
  },
  PingServer() {
    trace("PingServer");
  },
  Goal(id, name) {
    trace("Goal", id, name);
  },
  CustomMetric(name) {
    trace("CustomMetric", name);
  },
  LevelCounterMetric(name, value) {
    trace("LevelCounterMetric", name, value);
  },
  LevelRangedMetric(name, value, range) {
    trace("LevelRangedMetric", name, value, range);
  },
  LevelAverageMetric(name, value, range) {
    trace("LevelAverageMetric", name, value, range);
  }
};

// src/core/UT.ts
var UT = {
  /** Shortest signed angular delta to rotate from `from` to `to` (degrees). */
  rotateDistance(from, to) {
    return UT.fixRotation(to - from);
  },
  /** Wrap an angle into (-180, 180]. */
  fixRotation(a) {
    if (a > 180) a -= 360;
    if (a < -180) a += 360;
    return a;
  },
  /**
   * Angle (degrees) of the vector from (x1,y1) to (x2,y2), wrapped to
   * (-180,180]. Original computed this via acos with a sign flip on dy; that is
   * exactly atan2(dy, dx).
   */
  getRotation(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return UT.fixRotation(Math.atan2(dy, dx) * 180 / Math.PI);
  },
  /** Uniform random float in [min, max). */
  rand(min, max) {
    return Math.random() * (max - min) + min;
  },
  /** Round to one decimal place. */
  fixFloat(n) {
    return Math.round(n * 10) / 10;
  },
  /** e.g. 1 -> "1st", 2 -> "2nd", 11 -> "11th". */
  getOrdinal(n) {
    const mod100 = n % 100;
    let suffix;
    if (mod100 > 10 && mod100 < 14) {
      suffix = "th";
    } else {
      switch (n % 10) {
        case 1:
          suffix = "st";
          break;
        case 2:
          suffix = "nd";
          break;
        case 3:
          suffix = "rd";
          break;
        default:
          suffix = "th";
      }
    }
    return n + suffix;
  },
  /** +1 or -1: the direction to rotate from `from` toward `to`. */
  rotateDirection(from, to) {
    return UT.fixRotation(to - from) <= 0 ? -1 : 1;
  },
  /** Euclidean distance between two points. */
  getDist(x1, y1, x2, y2) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return Math.sqrt(dx * dx + dy * dy);
  },
  /** Human-readable ratio string, e.g. kills:deaths -> "2.5 : 1". */
  getRatio(a, b) {
    if (!a && !b) return "0 : 0";
    if (!a) return "0 : " + b;
    if (!b) return a + " : 0";
    if (a === b) return "1 : 1";
    if (a > b) return Math.round(a / b * 100) / 100 + " : 1";
    return "1 : " + Math.round(b / a * 100) / 100;
  },
  /** Uniform random integer in [min, max] inclusive. */
  irand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
};

// src/audio/Sounds.ts
var MANIFEST = {
  // weapons
  PistolFire: "184_S_PistolFire.mp3",
  PistolReload: "185_S_PistolReload.mp3",
  Arifle2: "165_S_Arifle2.mp3",
  Assault_Slide: "190_Assault_Slide.mp3",
  Assault_Clipin: "191_Assault_Clipin.mp3",
  Assault_Clipout: "193_Assault_Clipout.mp3",
  Uzi1: "173_S_Uzi1.mp3",
  Uzi2: "174_S_Uzi2.mp3",
  ShotgunFire: "180_S_ShotgunFire.mp3",
  ShotgunPump: "181_S_ShotgunPump.mp3",
  ShotgunShell: "189_S_ShotgunShell.mp3",
  SniperFire: "164_S_SniperFire.mp3",
  RailReload: "182_S_RailReload.mp3",
  Lightning: "186_S_Lightning.mp3",
  Chainfire: "183_S_Chainfire.mp3",
  windup: "170_S_windup.mp3",
  winddown: "169_S_winddown.mp3",
  Zapper: "194_S_Zapper.mp3",
  Rocket: "187_S_Rocket.mp3",
  rocketexplode: "171_S_rocketexplode.mp3",
  Nadeout: "192_S_Nadeout.mp3",
  explodenade: "175_S_explodenade.mp3",
  nadeClipin: "166_S_nadeClipin.mp3",
  nadeClipout: "167_S_nadeClipout.mp3",
  BossFire: "176_S_BossFire.mp3",
  GunClick: "162_S_GunClick.mp3",
  Pull: "168_S_Pull.mp3",
  SGClip: "188_SGClip.mp3",
  // feedback
  Headshot1: "177_S_Headshot1.mp3",
  Headshot2: "178_S_Headshot2.mp3",
  Headshot3: "179_S_Headshot3.mp3",
  Medal: "163_S_Medal.mp3",
  Beep: "172_S_Beep.mp3",
  // music
  M_Menu: "199_M_Menu.mp3",
  M_Boss: "1_M_Boss.mp3",
  M_Baby: "195_M_Baby.mp3",
  M_Crowd: "196_M_Crowd.mp3",
  M_Acid: "197_M_Acid.mp3",
  M_Dnb: "198_M_Dnb.mp3",
  M_Protos: "200_M_Protos.mp3",
  M_Rocket: "2_M_Rocket.mp3"
};
var SoundManager = class {
  ctx = null;
  master = null;
  musicGain = null;
  buffers = /* @__PURE__ */ new Map();
  musicSrc = null;
  currentMusic = "";
  loaded = false;
  /** Lazily create the context (must follow a user gesture in most browsers). */
  ensureCtx() {
    if (typeof AudioContext === "undefined") return null;
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
  async loadAll(onProgress) {
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
        } finally {
          onProgress?.(++done, keys.length);
        }
      })
    );
    this.loaded = true;
  }
  /** Resume the context on a user gesture (call from click/keydown). */
  resume() {
    this.ensureCtx();
  }
  play(key, volume = 1, pan = 0) {
    if (!SD.sound || !this.ctx || !this.master) return;
    const buf = this.buffers.get(key);
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
  /** Distance-attenuated, panned playback (SoundHandler.playDistantSound). */
  playDistant(key, x, y) {
    if (!SD.sound) return;
    const cx = GAME_WIDTH / 2;
    const cy = 300;
    const dist = UT.getDist(x, y, cx, cy);
    let vol = 1 - dist / 700;
    if (vol < 0.03) vol = 0.03;
    if (vol > 1) vol = 1;
    let pan = (x - cx) / 350;
    if (pan < -1) pan = -1;
    if (pan > 1) pan = 1;
    this.play(key, vol, pan);
  }
  /** Loop a music track, replacing any current one. */
  setMusic(key) {
    if (!SD.music) return;
    if (this.currentMusic === key) return;
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const buf = this.buffers.get(key);
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
  stopMusic() {
    if (this.musicSrc) {
      try {
        this.musicSrc.stop();
      } catch {
      }
      this.musicSrc = null;
    }
    this.currentMusic = "";
  }
};
var Sound = new SoundManager();

// src/game/Achievements.ts
var MEDALS = {
  rank: {
    name: "Like a Boss",
    desc: "Get the top score in a deathmatch on the hardest difficulty.",
    icon: 1
  },
  nodie: {
    name: "Untouchable",
    desc: "Complete a quick match on medium or harder with twice as many kills as deaths.",
    icon: 2
  },
  human: { name: "Hero of War", desc: "Complete the human campaign", icon: 3 },
  alien: {
    name: "Conqueror of Races",
    desc: "Complete the alien campaign.",
    icon: 4
  },
  headshot: { name: "Boom, Headshot!", desc: "Get 50 headshot kills.", icon: 5 },
  addicted: { name: "Addicted", desc: "Play a total of 50 matches.", icon: 6 },
  pistol: {
    name: "Mmmm, Pistol Whip",
    desc: "Complete a match using only the pistol.",
    icon: 7
  },
  gravekill: {
    name: "Death from Beyond the Grave",
    desc: "Kill an enemy while waiting to respawn.",
    icon: 8
  },
  guns: {
    name: "Indecisive",
    desc: "Get a kill with every weapon in 1 game.",
    icon: 9
  },
  return: {
    name: "Return to Sender",
    desc: "Kill an enemy with his own sticky grenade that is stuck to you.",
    icon: 10
  },
  railgun: {
    name: "Knockout",
    desc: "Kill 3 enemies with 1 shot from the railgun.",
    icon: 11
  },
  complete: { name: "Achievements are complete!", desc: "LOLOLZ", icon: 12 }
};
var NAMES = [
  "rank",
  "nodie",
  "human",
  "alien",
  "headshot",
  "addicted",
  "pistol",
  "gravekill",
  "guns",
  "return",
  "complete"
];
var Achievements = {
  /** UI popup, registered by the overlay. Null in headless contexts. */
  popup: null,
  /** Return the medal key at a 1-based menu index. */
  getName(index) {
    return NAMES[index - 1];
  },
  /** Look up medal data for a key. Pure — does not award. */
  getAch(key) {
    return MEDALS[key] ?? MEDALS.complete;
  },
  /**
   * Award a medal (unless already earned, or we're in the tutorial level where
   * achievements are suppressed). Fires the popup + medal sound.
   */
  addAch(key) {
    const suppressed = SD.medals[key] || SD.matchSettings.level && SD.matchSettings.level == 1;
    if (suppressed) return;
    SD.medals[key] = true;
    SD.save();
    Sound.play("Medal");
    this.popup?.show(this.getAch(key));
  }
};

// src/state/SD.ts
var SAVE_KEY = "DkjdsJfjhdJe342J";
var SDState = class {
  matchSettings = {};
  sound = true;
  stats;
  curStage = 1;
  showUnlock = "";
  profile;
  music = true;
  menuQual = 2;
  qual = "low";
  language = "English";
  medals = {};
  noGlow = false;
  curCampaign = "human";
  paused = false;
  scores = false;
  introSkip = false;
  ssMode = false;
  game = null;
  init() {
    this.curCampaign = "human";
    this.load();
  }
  setGame(g) {
    this.game = g;
  }
  removeGame() {
    this.game = null;
  }
  /** Toggle in-game pause. Returns false if paused isn't currently allowed. */
  togglePause() {
    const g = this.game;
    if (!g || g.gameOver || !g.gameStarted) return false;
    if (this.scores || this.ssMode) {
      this.scores = false;
      g.setPause(true);
      this.setSSmode(false);
    } else if (!this.paused) {
      this.paused = true;
      g.setPause(true);
    } else {
      this.paused = false;
      g.setUnPause();
    }
    return true;
  }
  /** Toggle the scoreboard overlay (also pauses). */
  toggleScores() {
    const g = this.game;
    if (!g || g.gameOver || !g.gameStarted) return false;
    if (!this.scores) {
      this.scores = true;
      this.paused = true;
      g.setPause(true);
      this.setSSmode(false);
    } else {
      this.scores = false;
      this.paused = false;
      g.setUnPause();
    }
    return true;
  }
  /** Screenshot mode: hide all HUD chrome so the arena can be captured clean. */
  setSSmode(on) {
    const g = this.game;
    if (!g) return;
    const hud = g.hud;
    if (this.ssMode === on) return;
    if (g.main && g.main._stage) {
      g.main._stage.quality = on ? "high" : this.qual;
    }
    this.ssMode = on;
    const vis = !on;
    if (hud) {
      const fields = [
        "hpBar",
        "shBar",
        "gunBox",
        "pos1Box",
        "pos2Box",
        "score1Box",
        "score2Box",
        "score1Bar",
        "score2Bar",
        "hpBox",
        "shBox",
        "nameBox",
        "timeBox",
        "matchBox"
      ];
      for (const f of fields) if (hud[f]) hud[f].visible = vis;
      if (hud.bigText) hud.bigText.visible = vis;
      for (let i = 0; i < 10; i++) {
        if (hud["gun" + i]) hud["gun" + i].visible = vis;
      }
      if (hud.msgRoll) {
        for (const m of hud.msgRoll) if (m) m.visible = vis;
      }
    }
    for (const u of g.units) {
      if (u && u.topText) u.topText.visible = vis;
    }
  }
  // --- progression -------------------------------------------------------
  addWin() {
    this.stats.won++;
    this.matchSettings.won = true;
    if (this.matchSettings.campaign && this.matchSettings.campaign === this.curStage) {
      if (this.curStage === 15) {
        this.showUnlock = "unlock_alien";
        Achievements.addAch("human");
        Log.CustomMetric("Completed Human Campaign");
      }
      if (this.curStage === 30) {
        this.showUnlock = "unlock_beatgame";
        Achievements.addAch("alien");
        Log.CustomMetric("Completed Alien Campaign");
      }
      if (this.curStage < 30) {
        this.curStage++;
      }
    }
    if (this.stats.lost + this.stats.won === 50) {
      Achievements.getAch("addicted");
    }
  }
  addLoss() {
    this.stats.lost++;
    this.matchSettings.won = false;
    if (this.stats.lost + this.stats.won === 50) {
      Achievements.getAch("addicted");
    }
  }
  unLockAll(campaign) {
    this.curStage = 15 * campaign;
    this.save();
  }
  lockAll() {
    this.curStage = 1;
    this.save();
  }
  // --- outbound links ----------------------------------------------------
  urlTwitter() {
    window.open("https://twitter.com/armorgames", "_blank");
    Log.CustomMetric("Clicked Twitter link");
  }
  urlFacebook() {
    window.open("https://www.facebook.com/ArmorGames", "_blank");
    Log.CustomMetric("Clicked Facebook link");
  }
  urlSponsor() {
    window.open("https://www.armorgames.com", "_blank");
    Log.CustomMetric("Clicked Armorgames link");
  }
  urlJuice() {
    window.open("https://www.juice-tin.com", "_blank");
    Log.CustomMetric("Clicked Juice-Tin link");
  }
  urlAdd() {
  }
  // --- persistence -------------------------------------------------------
  newGame() {
    this.introSkip = false;
    this.language = "English";
    this.profile = {
      name: "Player",
      pers: "gamer",
      prof_action: "idle",
      prof_preset: 1,
      prof_head: 1,
      prof_body: 1,
      prof_legs: 1
    };
    this.stats = {
      kills: 0,
      deaths: 0,
      suicides: 0,
      headshots: 0,
      won: 0,
      lost: 0,
      killstreak: 0,
      shots: 0,
      shotsHit: 0
    };
    this.noGlow = false;
    this.qual = "low";
    this.menuQual = 2;
    this.curStage = 1;
    this.sound = true;
    this.music = true;
    this.medals = {};
    this.save();
  }
  load() {
    let data = null;
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) data = JSON.parse(raw);
    } catch {
      data = null;
    }
    if (data && data.savedBefore) {
      this.introSkip = data.introSkip;
      this.language = data.language;
      this.profile = data.profile;
      this.stats = data.stats;
      this.noGlow = data.noGlow;
      this.qual = data.qual;
      this.menuQual = data.menuQual;
      this.curStage = data.curStage;
      this.sound = true;
      this.music = true;
      this.medals = data.medals;
    } else {
      this.newGame();
    }
  }
  save() {
    const data = {
      savedBefore: true,
      introSkip: true,
      profile: this.profile,
      stats: this.stats,
      language: this.language,
      noGlow: this.noGlow,
      qual: this.qual,
      menuQual: this.menuQual,
      curStage: this.curStage,
      sound: this.sound,
      music: this.music,
      medals: this.medals
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
    }
  }
};
var SD = new SDState();

// src/game/Hud.ts
var FONT = "Consolas, 'Courier New', monospace";
var C_PANEL = 856343;
var C_PANEL_LINE = 2765629;
var C_TRACK = 1119771;
var C_HP = 5490266;
var C_HP_LOW = 14700602;
var C_SHIELD = 4891647;
var C_TEXT = 15199731;
var C_DIM = 9148581;
var C_ACCENT = 16763955;
var C_ICON_BOX = 1844011;
var GUN_COLOR = {
  pistol: 13226457,
  uzi: 13226457,
  rifle: 13226457,
  chaingun: 16757575,
  plasma: 12093439,
  shotgun: 16747069,
  sniper: 7328767,
  railgun: 7328767,
  grenade: 9426538,
  rocket: 16734797
};
var BAR_W = 220;
var BAR_X = Math.round((GAME_WIDTH - BAR_W) / 2);
var HP_Y = 24;
var HP_H = 18;
var SH_Y = HP_Y + HP_H + 4;
var SH_H = 12;
var SB_X = 10;
var SB_Y = 10;
var SB_W = 196;
var SB_ROW_H = 18;
var SB_H = 8 + SB_ROW_H * 2 + 4;
var WP_X = SB_X;
var WP_Y = SB_Y + SB_H + 8;
var WP_W = SB_W;
var WP_H = 54;
var ICON_X = WP_X + 10;
var ICON_Y = WP_Y + 8;
var ICON_W = 46;
var ICON_H = WP_H - 16;
var TR_X = GAME_WIDTH - 12;
var DEFAULT_TIMER = 300 * FPS;
var ORDINALS = ["1st", "2nd"];
var Hud = class {
  constructor(game2) {
    this.game = game2;
    this.view.addChild(this.chromeG);
    this.view.addChild(this.dynG);
    this.nameText = this.mkText(13, C_TEXT, true);
    this.nameText.anchor.set(0.5, 0);
    this.nameText.x = GAME_WIDTH / 2;
    this.nameText.y = 4;
    this.view.addChild(this.nameText);
    this.hpText = this.mkText(11, 16777215, true);
    this.hpText.anchor.set(0.5, 0.5);
    this.hpText.x = GAME_WIDTH / 2;
    this.hpText.y = HP_Y + HP_H / 2;
    this.view.addChild(this.hpText);
    this.shText = this.mkText(10, 16777215, true);
    this.shText.anchor.set(0.5, 0.5);
    this.shText.x = GAME_WIDTH / 2;
    this.shText.y = SH_Y + SH_H / 2;
    this.view.addChild(this.shText);
    for (let i = 0; i < 2; i++) {
      const y = SB_Y + 6 + i * SB_ROW_H;
      const pos = this.mkText(11, C_ACCENT, true);
      pos.x = SB_X + 8;
      pos.y = y;
      this.view.addChild(pos);
      const name = this.mkText(11, C_TEXT, false);
      name.x = SB_X + 40;
      name.y = y;
      this.view.addChild(name);
      const score = this.mkText(11, C_TEXT, true);
      score.anchor.set(1, 0);
      score.x = SB_X + SB_W - 8;
      score.y = y;
      this.view.addChild(score);
      this.sbRows.push({ pos, name, score });
    }
    this.gunName = this.mkText(15, C_TEXT, true);
    this.gunName.x = ICON_X + ICON_W + 12;
    this.gunName.y = WP_Y + 9;
    this.view.addChild(this.gunName);
    this.gunAmmo = this.mkText(12, C_ACCENT, true);
    this.gunAmmo.x = ICON_X + ICON_W + 12;
    this.gunAmmo.y = WP_Y + 30;
    this.view.addChild(this.gunAmmo);
    this.modeText = this.mkText(13, C_ACCENT, true);
    this.modeText.anchor.set(1, 0);
    this.modeText.x = TR_X;
    this.modeText.y = 8;
    this.view.addChild(this.modeText);
    this.timerText = this.mkText(22, C_TEXT, true);
    this.timerText.anchor.set(1, 0);
    this.timerText.x = TR_X;
    this.timerText.y = 26;
    this.view.addChild(this.timerText);
    this.banner = new Text({
      text: "",
      style: new TextStyle({
        fill: C_ACCENT,
        fontFamily: FONT,
        fontSize: 34,
        fontWeight: "bold",
        align: "center",
        letterSpacing: 1,
        stroke: { color: 0, width: 5 },
        dropShadow: {
          color: 0,
          blur: 4,
          distance: 2,
          alpha: 0.6,
          angle: Math.PI / 2
        }
      })
    });
    this.banner.anchor.set(0.5);
    this.banner.x = GAME_WIDTH / 2;
    this.banner.y = 120;
    this.view.addChild(this.banner);
    this.drawChrome();
  }
  view = new Container();
  gunOrder = GUN_ORDER.slice();
  /** Static chrome (panels / tracks / labels drawn once). */
  chromeG = new Graphics();
  /** Everything that changes per frame (bar fills + weapon glyph). */
  dynG = new Graphics();
  // Top-centre.
  nameText;
  hpText;
  shText;
  // Weapon panel.
  gunName;
  gunAmmo;
  // Scoreboard (1st / 2nd).
  sbRows = [];
  // Top-right.
  modeText;
  timerText;
  banner;
  /** Countdown, in frames. Decremented once per gameplay frame. */
  timerTicks = DEFAULT_TIMER;
  mkText(size, fill, bold) {
    return new Text({
      text: "",
      style: new TextStyle({
        fill,
        fontFamily: FONT,
        fontSize: size,
        fontWeight: bold ? "bold" : "normal"
      })
    });
  }
  /** Static panels + bar tracks + icon box, drawn once. */
  drawChrome() {
    const g = this.chromeG;
    g.clear();
    g.rect(BAR_X - 2, HP_Y - 2, BAR_W + 4, HP_H + SH_H + 4 + 4).fill({ color: C_PANEL, alpha: 0.55 }).stroke({ color: C_PANEL_LINE, width: 1, alpha: 0.9 });
    g.rect(BAR_X, HP_Y, BAR_W, HP_H).fill({ color: C_TRACK });
    g.rect(BAR_X, SH_Y, BAR_W, SH_H).fill({ color: C_TRACK });
    this.panel(g, SB_X, SB_Y, SB_W, SB_H);
    this.panel(g, WP_X, WP_Y, WP_W, WP_H);
    g.rect(ICON_X, ICON_Y, ICON_W, ICON_H).fill({ color: C_ICON_BOX, alpha: 0.95 }).stroke({ color: C_PANEL_LINE, width: 1, alpha: 0.9 });
  }
  panel(g, x, y, w, h2) {
    g.rect(x, y, w, h2).fill({ color: C_PANEL, alpha: 0.62 }).stroke({ color: C_PANEL_LINE, width: 1, alpha: 0.9 });
  }
  setBanner(text) {
    this.banner.text = text;
  }
  enterFrame() {
    const p = this.game.player;
    const g = this.dynG;
    g.clear();
    if (this.game.gameStarted && !this.game.gameOver && !SD.paused) {
      if (this.timerTicks > 0) this.timerTicks--;
    }
    this.drawTimerAndMode();
    this.drawScoreboard();
    if (!p) return;
    this.drawBars(p);
    this.drawWeapon(p);
  }
  drawBars(p) {
    const g = this.dynG;
    const dead = p.status?.dead;
    const hpPer = dead ? 0 : clamp01(p.status.getHpPer());
    const shPer = dead ? 0 : clamp01(p.status.getShPer());
    if (hpPer > 0) {
      const col = hpPer <= 0.3 ? C_HP_LOW : C_HP;
      g.rect(BAR_X, HP_Y, Math.max(2, BAR_W * hpPer), HP_H).fill({ color: col });
    }
    if (shPer > 0) {
      g.rect(BAR_X, SH_Y, Math.max(2, BAR_W * shPer), SH_H).fill({
        color: C_SHIELD
      });
    }
    this.nameText.text = p._name || "Player";
    this.hpText.text = `Health: ${Math.round(hpPer * 100)}%`;
    this.shText.text = `Shield: ${Math.round(shPer * 100)}%`;
  }
  drawWeapon(p) {
    if (p.status?.dead) {
      this.gunName.text = p.canRespawn ? "RESPAWN" : "DOWN";
      this.gunAmmo.text = p.canRespawn ? "click to respawn" : "waiting...";
      this.drawGunGlyph(C_DIM);
      return;
    }
    const gun = p.gun?.curGun;
    if (!gun) {
      this.gunName.text = "";
      this.gunAmmo.text = "";
      return;
    }
    this.gunName.text = String(gun.id).toUpperCase();
    if (gun.percAmmo) {
      const pct = Math.round(gun.curClip / gun.maxClip * 100);
      this.gunAmmo.text = `Clip: ${pct}%`;
    } else {
      this.gunAmmo.text = `Clip: ${gun.curClip} / ${gun.maxClip}`;
    }
    this.gunName.style.fill = p.gun?.reloading ? C_ACCENT : C_TEXT;
    this.drawGunGlyph(GUN_COLOR[gun.id] ?? C_TEXT);
  }
  /** A compact, category-tinted vector gun silhouette inside the icon box. */
  drawGunGlyph(color) {
    const g = this.dynG;
    const cx = ICON_X + ICON_W / 2;
    const cy = ICON_Y + ICON_H / 2;
    const bw = 34;
    const bh = 7;
    const bx = cx - bw / 2;
    const by = cy - 4;
    g.rect(bx, by, bw, bh).fill({ color });
    g.rect(bx, by, 6, bh).fill({ color: 0, alpha: 0.25 });
    g.rect(bx + bw - 16, by + bh - 1, 8, 13).fill({ color });
    g.rect(bx + bw - 18, by - 4, 5, 4).fill({ color });
  }
  drawScoreboard() {
    const ranked = this.game.units.slice().sort((a, b) => b.getScore - a.getScore).slice(0, 2);
    const me = this.game.player;
    for (let i = 0; i < 2; i++) {
      const row = this.sbRows[i];
      const u = ranked[i];
      if (!u) {
        row.pos.text = ORDINALS[i];
        row.name.text = "-";
        row.score.text = "";
        continue;
      }
      const isMe = u === me;
      row.pos.text = ORDINALS[i];
      row.name.text = (u._name || "?").slice(0, 12);
      row.score.text = String(u.getScore);
      const col = isMe ? C_ACCENT : u.status?.dead ? C_DIM : C_TEXT;
      row.name.style.fill = col;
      row.score.style.fill = col;
    }
  }
  drawTimerAndMode() {
    const team = !!SD.matchSettings?.team;
    this.modeText.text = team ? "Team Deathmatch" : "Deathmatch";
    const secs = Math.ceil(this.timerTicks / FPS);
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    this.timerText.text = `${m}:${s < 10 ? "0" : ""}${s}`;
  }
};
function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

// <stdin>
var game = { player: { _name: "Me", status: { dead: false, getHpPer: () => 0.92, getShPer: () => 0.58 }, gun: { curGun: { id: "rifle", curClip: 24, maxClip: 30, percAmmo: false }, reloading: false } }, units: [{ _name: "Me", getScore: 12, status: { dead: false } }, { _name: "Bot", getScore: 9, status: { dead: false } }], gameStarted: true, gameOver: false };
var h = new Hud(game);
h.setBanner("Get Ready");
for (let i = 0; i < 40; i++) h.enterFrame();
console.log("HUD_OK view children:", h.view.children.length, "gunOrder:", h.gunOrder.length);
