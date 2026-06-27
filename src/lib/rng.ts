// Deterministic, seedable RNG so a given (seed, x, y) always generates the same
// tile — the backbone of reproducible procedural generation.

export type Rng = () => number;

/** Fast 32-bit PRNG. Same seed → same stream. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix several integers into one 32-bit seed (order-sensitive). */
export function hashSeed(...nums: number[]): number {
  let h = 0x811c9dc5;
  for (const n of nums) {
    h ^= n | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

/** RNG dedicated to a single tile of a run. */
export function tileRng(seed: number, x: number, y: number): Rng {
  return mulberry32(hashSeed(seed, x * 73856093, y * 19349663));
}

export function randInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** Weighted pick: entries are [item, weight]. */
export function weighted<T>(rng: Rng, entries: readonly (readonly [T, number])[]): T {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [item, w] of entries) {
    r -= w;
    if (r <= 0) return item;
  }
  return entries[entries.length - 1][0];
}

export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}
