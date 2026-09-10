/**
 * Math / string utility helpers. Ported from UT.as.
 *
 * The decompiler emitted §§push/§§pop stack noise for several of these; the
 * implementations below are the reconstructed intended semantics. Angles are in
 * degrees unless noted, matching the original which mixed degrees for game logic
 * with radians only at the trig boundary.
 */
export const UT = {
  /** Shortest signed angular delta to rotate from `from` to `to` (degrees). */
  rotateDistance(from: number, to: number): number {
    return UT.fixRotation(to - from);
  },

  /** Wrap an angle into (-180, 180]. */
  fixRotation(a: number): number {
    if (a > 180) a -= 360;
    if (a < -180) a += 360;
    return a;
  },

  /**
   * Angle (degrees) of the vector from (x1,y1) to (x2,y2), wrapped to
   * (-180,180]. Original computed this via acos with a sign flip on dy; that is
   * exactly atan2(dy, dx).
   */
  getRotation(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return UT.fixRotation((Math.atan2(dy, dx) * 180) / Math.PI);
  },

  /** Uniform random float in [min, max). */
  rand(min: number, max: number): number {
    return Math.random() * (max - min) + min;
  },

  /** Round to one decimal place. */
  fixFloat(n: number): number {
    return Math.round(n * 10) / 10;
  },

  /** e.g. 1 -> "1st", 2 -> "2nd", 11 -> "11th". */
  getOrdinal(n: number): string {
    const mod100 = n % 100;
    let suffix: string;
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
  rotateDirection(from: number, to: number): number {
    return UT.fixRotation(to - from) <= 0 ? -1 : 1;
  },

  /** Euclidean distance between two points. */
  getDist(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return Math.sqrt(dx * dx + dy * dy);
  },

  /** Human-readable ratio string, e.g. kills:deaths -> "2.5 : 1". */
  getRatio(a: number, b: number): string {
    if (!a && !b) return "0 : 0";
    if (!a) return "0 : " + b;
    if (!b) return a + " : 0";
    if (a === b) return "1 : 1";
    if (a > b) return Math.round((a / b) * 100) / 100 + " : 1";
    return "1 : " + Math.round((b / a) * 100) / 100;
  },

  /** Uniform random integer in [min, max] inclusive. */
  irand(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },
} as const;
