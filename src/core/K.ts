/**
 * Input direction bit flags. Ported from K.as.
 * Units store their current input intent as a bitmask of these.
 */
export const K = {
  UP: 1,
  DOWN: 2,
  LEFT: 4,
  RIGHT: 8,
  MOUSE: 16,
} as const;

export type KFlag = (typeof K)[keyof typeof K];
