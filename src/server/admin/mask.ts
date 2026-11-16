/** Groups smaller than this are never shown exactly, so nobody can be singled out from a breakdown. */
export const MIN_GROUP_SIZE = 5;

export type Masked = number | "<5";

export const maskCount = (value: number): Masked => (value > 0 && value < MIN_GROUP_SIZE ? "<5" : value);

/** Percentage (0-100, one decimal) only when both the part and the whole are large enough to be shown. */
export function safeShare(part: number, whole: number): number | null {
  if (whole < MIN_GROUP_SIZE || (part > 0 && part < MIN_GROUP_SIZE)) return null;
  return Math.round((part / whole) * 1000) / 10;
}

export type Counted = { count: Masked; share: number | null };
export const counted = (part: number, whole: number): Counted => ({ count: maskCount(part), share: safeShare(part, whole) });
