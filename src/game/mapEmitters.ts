import { UT } from "../core/UT";
import type { Behave } from "./MapParticles";

/**
 * The authored ambient-particle placements, transcribed from
 * `Stats_MapParticles.as`.
 *
 * Each map has two blocks. `init` is the one-time placement `mapInit` runs when
 * the level loads — the fairies and the fish, forced on regardless of where the
 * camera is. `frame` is the per-tick emitter run, which returns whatever this
 * frame should spawn; the caller drops anything more than 300px off screen, so
 * a map's whole set costs only what is near the player.
 *
 * `part` is the player's "Particles" setting, 0..3, and the original uses it as
 * a plain number rather than a switch — `graphPart1 = 2 * SD.graphPart` is a
 * literal loop bound, `6 - SD.graphPart` is a modulus, and at 0 the rising
 * motes stop. Those expressions are kept as written.
 *
 * Map ids here are the SWF's particle-set names, which for every map this port
 * ships are the same as its geometry id. Two sets are authored for variants the
 * port does not ship separately (`ocean2` shares ocean's, `snow2` is the
 * night-lights snow with falling snow) and are kept for reference.
 */

export interface Spawn {
  /** Where to put it; re-rolled per spawn so a span emits across its width. */
  pos: () => { x: number; y: number };
  behave: Behave;
  extra?: Record<string, number>;
  /** Art sub-animation, e.g. `leaf3`. */
  sub?: string;
  /** Pinned animation frame; 0 lets it play. */
  frame?: number;
  /** Spawn even when off screen (`mapInit` placements do). */
  force?: boolean;
}

export interface Emitter {
  init: Spawn[];
  frame: (
    fc: number,
    part: number,
    water?: { startWaveAtPos(x: number, amp: number): void },
  ) => Spawn[];
}

const at = (x: number, y: number) => () => ({ x, y });
const inBox = (x0: number, x1: number, y: number) => () => ({ x: UT.rand(x0, x1), y });

/** `UT.randLinePoint` — a uniform point along the segment (x0,y0)-(x1,y1). */
const onLine = (x0: number, y0: number, x1: number, y1: number) => () => {
  const t = Math.random();
  return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t };
};

/** A `raise` mote emitted along a segment. */
const raiseLine = (
  x0: number, y0: number, x1: number, y1: number,
  extra: Record<string, number>,
): Spawn =>
  ({ pos: onLine(x0, y0, x1, y1), behave: "raise", extra, sub: "idle", frame: 6 });

/** A `raise` mote emitted along a horizontal span. */
const raiseSpan = (x0: number, x1: number, y: number, extra: Record<string, number>): Spawn =>
  ({ pos: inBox(x0, x1, y), behave: "raise", extra, sub: "idle", frame: 6 });

const fairy = (x: number, y: number): Spawn =>
  ({ pos: at(x, y), behave: "fairy", sub: "idle", frame: UT.irand(1, 5), force: true });

const fishAt = (x: number, y: number): Spawn =>
  ({ pos: at(x, y), behave: "fish", sub: "fish", frame: 1, force: true });

const fishIn = (x0: number, x1: number, y0: number, y1: number): Spawn =>
  ({ pos: () => ({ x: UT.rand(x0, x1), y: UT.rand(y0, y1) }),
     behave: "fish", sub: "fish", frame: 1, force: true });

const drop = (x: number, y: number, min: number, max: number, hitframe: number): Spawn =>
  ({ pos: at(x, y), behave: "water", extra: { min, max, hitframe }, sub: "idle" });

const ember = (x: number, y: number): Spawn =>
  ({ pos: at(x, y), behave: "spark", sub: "idle" });

/** `uint(n)` — AS3 truncates toward zero on assignment to a uint loop bound. */
const uint = (n: number) => Math.max(0, Math.trunc(n));

/** `n` copies of the same placement. */
const times = (n: number, make: () => Spawn): Spawn[] =>
  Array.from({ length: n }, make);

/**
 * The gate every rising-mote block sits behind: at Low it emits on alternate
 * frames, at Medium and above every frame, and at 0 never.
 */
const raiseGate = (fc: number, part: number): boolean =>
  (part === 1 && fc % 2 === 0) || part === 2 || part === 3;

/** A 1-in-10 burst of `UT.irand(part, part * 5)` embers. */
function emberBurst(part: number, x: number, y: number): Spawn[] {
  if (Math.random() >= 0.1) return [];
  return times(UT.irand(part, part * 5), () => ember(x, y));
}

// --- jungle ----------------------------------------------------------------
// The fairy cluster over the pools, fish in both ponds, five waterfalls, and
// (by a deliberate fall-through in the original's switch) jungle2's vents too.

const JUNGLE_FAIRIES: Spawn[] = [
  fairy(741, 1578), fairy(756, 1574), fairy(811, 1566), fairy(811, 1566),
  fairy(1161, 1767), fairy(1298, 1748), fairy(1298, 1748),
  ...times(2, () => fairy(854, 1396)),
  ...times(3, () => fairy(1352, 1506)),
  ...times(3, () => fairy(2238, 1054)),
  ...times(2, () => fairy(675, 942)),
  ...times(2, () => fairy(1064, 1056)),
  ...times(2, () => fairy(573, 1251)),
];

/** `case 3` — jungle2's vents. jungle falls through into this block. */
function jungle2Vents(fc: number, part: number): Spawn[] {
  if (!raiseGate(fc, part)) return [];
  return [
    raiseSpan(354, 354 + 116, 1844, { spd: 2.5 }),
    raiseSpan(534, 534 + 117, 1943, { spd: 0.6 }),
    raiseSpan(2008, 2012 + 91, 1620, { spd: 0.7 }),
    raiseSpan(2443, 2443 + 122, 1835, { spd: 2.5 }),
  ];
}

export const EMITTERS: Record<string, Emitter> = {
  // --- tut (case 0) --------------------------------------------------------
  tut: {
    init: [],
    frame(fc, part) {
      const out: Spawn[] = times(uint(2 * part), () => drop(1398, 50, -1, 3, 20));
      if (raiseGate(fc, part)) {
        out.push(raiseLine(2353, 932, 2465, 889, { spd: 1, xspd: -2.3 }));
      }
      return out;
    },
  },

  // --- jungle (case 2, falling through into case 3) ------------------------
  jungle: {
    init: [
      ...JUNGLE_FAIRIES,
      ...times(8, () => fishIn(319, 889, 1874, 1929)),
      ...times(8, () => fishIn(2330, 2584, 1866, 1917)),
    ],
    frame(fc, part, water) {
      const out: Spawn[] = [];
      for (let i = 0; i < uint(2 * part); i++) {
        out.push(drop(2213, 503, -1.5, 1, 30), drop(1701, 781, -3, 1, 20));
      }
      for (let i = 0; i < uint(1.5 * part); i++) {
        out.push(
          drop(1369, 1233, -3, 0, 15),
          drop(1915, 1493, 0, 3, 15),
          drop(1811, 1703, -3, 0, 15),
        );
      }
      // The big fall keeps the pool below it permanently rippling.
      water?.startWaveAtPos(1750 + UT.rand(0, 100), 1);
      return out.concat(jungle2Vents(fc, part));
    },
  },

  // --- jungle2 (case 3) ----------------------------------------------------
  jungle2: {
    init: [
      fairy(741, 1578), fairy(756, 1574), fairy(811, 1566), fairy(811, 1566),
      fairy(1161, 1767), fairy(1298, 1748), fairy(1298, 1748),
      ...times(2, () => fairy(700, 950)),
      ...times(2, () => fairy(1300, 1427)),
      ...times(2, () => fairy(1100, 1030)),
      ...times(2, () => fairy(1550, 930)),
      ...times(2, () => fairy(2170, 1750)),
      ...times(3, () => fairy(854, 1396)),
      ...times(3, () => fairy(1352, 1506)),
      ...times(3, () => fairy(2238, 1054)),
      ...times(3, () => fairy(675, 942)),
      ...times(3, () => fairy(1064, 1056)),
      ...times(3, () => fairy(573, 1251)),
    ],
    frame: jungle2Vents,
  },

  // --- ocean (case 4) ------------------------------------------------------
  ocean: {
    init: [
      ...times(8, () => fishIn(357, 678, 1287, 1478)),
      fishAt(170, 1110), fishAt(268, 1203), fishAt(257, 1523), fishAt(1100, 1384),
      fishAt(897, 1452), fishAt(732, 1341), fishAt(928, 1433),
    ],
    frame(fc, part) {
      const out: Spawn[] = [];
      // Leaves blow across on a timer that speeds up with the setting.
      if (part && fc % (6 - part) === 0) {
        const pick = onLine(345, 1668, 1037, 1568);
        out.push({
          pos: () => {
            const p = pick();
            return { x: p.x + UT.irand(-5, 5), y: p.y + UT.irand(-5, 5) };
          },
          behave: "leaf", sub: `leaf${UT.irand(1, 4)}`,
        });
      }
      for (let i = 0; i < part; i++) {
        out.push(drop(285, 1684, -1, 3, 10), drop(227, 1856, -1, 3, 1));
      }
      if (raiseGate(fc, part)) {
        out.push(
          raiseSpan(43, 158, 1329, { spd: 1.6 }),
          raiseSpan(1983, 2100, 1857, { spd: 2.3 }),
        );
      }
      return out;
    },
  },

  // --- city (case 5) -------------------------------------------------------
  city: {
    init: [],
    frame(fc, part) {
      const out: Spawn[] = [];
      if (raiseGate(fc, part)) {
        out.push(
          raiseSpan(271, 385, 1455, { spd: 1 }),
          raiseSpan(633, 747, 1051, { spd: 1 }),
          raiseLine(1171, 659, 1288, 680, { spd: 0.8, xspd: 0.5 }),
          raiseSpan(2547, 2665, 1513, { spd: 2.5 }),
        );
      }
      out.push(...emberBurst(part, 1230, 801));
      for (let i = 0; i < part; i++) {
        // The one waterfall the author left with no `extra`: no sideways
        // spread and `hitframe` 0, so it splashes on the first solid pixel.
        out.push({ pos: at(1367, 1685), behave: "water", sub: "idle" });
      }
      out.push(...emberBurst(part, 2640, 1669));
      out.push(...emberBurst(part, 553, 1442));
      return out;
    },
  },

  // --- mines (case 6) ------------------------------------------------------
  mines: {
    init: [],
    frame(fc, part) {
      const out: Spawn[] = [];
      if (raiseGate(fc, part)) {
        out.push(
          raiseLine(2125, 1460, 2245, 1449, { spd: 0.6 }),
          raiseLine(2051, 1044, 2201, 980, { spd: 1, xspd: -1.3 }),
          raiseSpan(747, 866, 1775, { spd: 2.3 }),
        );
      }
      out.push(...emberBurst(part, 1661, 1259));
      out.push(...emberBurst(part, 568, 1755));
      return out;
    },
  },

  // --- mines2 (case 7) — the same vents, no embers -------------------------
  mines2: {
    init: [],
    frame(fc, part) {
      if (!raiseGate(fc, part)) return [];
      return [
        raiseLine(2125, 1460, 2245, 1449, { spd: 0.6 }),
        raiseLine(2051, 1044, 2201, 980, { spd: 1, xspd: -1.3 }),
        raiseSpan(747, 866, 1775, { spd: 2.3 }),
      ];
    },
  },

  // --- space (case 8) ------------------------------------------------------
  space: {
    init: [],
    frame(fc, part) {
      const out: Spawn[] = [];
      if (raiseGate(fc, part)) {
        out.push(
          raiseLine(2492, 1968, 2579, 1946, { spd: 2.5, xspd: -2.4 }),
          raiseLine(220, 1608, 299, 1649, { spd: 2.5, xspd: 3.4 }),
        );
      }
      out.push(...emberBurst(part, 1393, 2598));
      out.push(...emberBurst(part, 1594, 2661));
      out.push(...emberBurst(part, 677, 1935));
      out.push(...emberBurst(part, 2614, 2491));
      return out;
    },
  },

  // --- desert (case 9) -----------------------------------------------------
  desert: {
    init: [],
    frame(fc, part) {
      const out: Spawn[] = [];
      out.push(...emberBurst(part, 1699, 845));
      out.push(...emberBurst(part, 1242, 1099));
      out.push(...emberBurst(part, 772, 868));
      if (raiseGate(fc, part)) out.push(raiseSpan(41, 158, 956, { spd: 0.6 }));
      return out;
    },
  },

  // --- snow (case 10) ------------------------------------------------------
  // The day variant: the two vents, but no falling snow — that is `snow2`.
  snow: {
    init: [],
    frame(fc, part) {
      if (!raiseGate(fc, part)) return [];
      return [
        raiseLine(2423, 1304, 2495, 1272, { spd: 2.5, xspd: -4 }),
        raiseLine(324, 1277, 396, 1304, { spd: 2.5, xspd: 4 }),
      ];
    },
  },

  // --- snow2 (case 11) — the night-lights variant, with snowfall -----------
  snow2: {
    init: [],
    frame(fc, part) {
      const out: Spawn[] = [];
      // `4 - part`: Ultra snows every frame, Low not at all.
      const every = 4 - part;
      if (every < 4 && fc % every === 0) {
        out.push({
          pos: inBox(60, 2600, 60),
          behave: "snow", sub: "idle", frame: UT.irand(1, 3), force: true,
        });
      }
      if (raiseGate(fc, part)) {
        out.push(
          raiseLine(2423, 1304, 2495, 1272, { spd: 2.5, xspd: -4 }),
          raiseLine(324, 1277, 396, 1304, { spd: 2.5, xspd: 4 }),
        );
      }
      return out;
    },
  },
};

/** `ocean2` shares ocean's set (one `case` label for both). */
EMITTERS.ocean2 = EMITTERS.ocean;
