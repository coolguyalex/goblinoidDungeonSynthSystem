// Seedable PRNG so a "take" (one generated piece) can be pinned and replayed exactly.
// mulberry32 is a small, fast, good-enough-for-music PRNG — no need for crypto-grade
// randomness here, just determinism given the same seed.

export function randomSeed() {
  return Math.floor(Math.random() * 0xffffffff);
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
