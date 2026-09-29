// Disc wear (Settings → DISC WEAR): a disc that's been played a lot looks it. From ten plays of its album, hairline
// scratches and scuffs; from fifty, scratches round the way it spins and a greasy fingerprint; from a hundred, more
// prints and little chips out of the rim. Where every mark goes comes from the album's name, so a disc has the same
// marks every time it goes in, and playing it more only adds new ones next to them.

// FNV-1a: a spread-out number from a name, the same in every run.
export function hash(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}
// mulberry32: a repeatable run of numbers in [0, 1) from one seed.
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;
const INNER = 0.42, OUTER = 0.95; // the printed part of the disc, as fractions of its radius

// How many of each mark after `plays` plays of the album. Each kind has its own run of marks, so more plays of one
// kind never moves the marks of another.
const COUNTS = {
  scratches: (n) => (n < 10 ? 0 : Math.min(24, 2 + Math.floor((n - 10) / 4))),
  scuffs: (n) => (n < 10 ? 0 : Math.min(10, 1 + Math.floor((n - 10) / 10))),
  rings: (n) => (n < 50 ? 0 : Math.min(14, 1 + Math.floor((n - 50) / 6))),
  prints: (n) => (n < 50 ? 0 : n < 100 ? 1 : Math.min(3, 2 + Math.floor((n - 100) / 100))),
  chips: (n) => (n < 100 ? 0 : Math.min(8, 1 + Math.floor((n - 100) / 20))),
};
const between = (rnd, lo, hi) => lo + (hi - lo) * rnd();
const MAKE = {
  // A short, nearly straight hairline, at an angle to the way the disc turns.
  scratches: (rnd) => ({ r: between(rnd, INNER, OUTER), a: rnd() * TAU, len: between(rnd, 0.06, 0.28), tilt: between(rnd, -1.2, 1.2), bend: between(rnd, -0.04, 0.04), w: between(rnd, 0.6, 1.4), alpha: between(rnd, 0.18, 0.4) }),
  // A patch of fine rubbing, mostly toward the rim where the disc is held.
  scuffs: (rnd) => ({ r: between(rnd, 0.62, OUTER), a: rnd() * TAU, size: between(rnd, 0.06, 0.14), lines: 6 + Math.floor(rnd() * 8), seed: Math.floor(rnd() * 2 ** 31), alpha: between(rnd, 0.1, 0.2) }),
  // Part of a circle round the hole: worn in as the disc spun in and out of its drive.
  rings: (rnd) => ({ r: between(rnd, INNER + 0.02, OUTER), a: rnd() * TAU, span: between(rnd, 0.3, 1.8), w: between(rnd, 0.5, 1), alpha: between(rnd, 0.1, 0.22) }),
  // A thumb's whorl, smudged.
  prints: (rnd) => ({ r: between(rnd, 0.55, 0.85), a: rnd() * TAU, size: between(rnd, 0.1, 0.14), rot: rnd() * TAU, ridges: 9 + Math.floor(rnd() * 4), seed: Math.floor(rnd() * 2 ** 31), alpha: between(rnd, 0.06, 0.1) }),
  // A nick out of the rim.
  chips: (rnd) => ({ a: rnd() * TAU, size: between(rnd, 0.012, 0.026) }),
};

/**
 * How worn a disc is after `plays` plays of its album; `seed` names the album ("artist\nalbum"). → null for a disc
 * as good as new, or { key, scratches, scuffs, rings, prints, chips }: each mark placed as fractions of the disc's
 * radius (r) and an angle (a), for disc.js to draw.
 */
export function wearFor(plays, seed) {
  const n = Math.max(0, Math.floor(plays || 0));
  if (n < 10) return null;
  const w = {};
  const key = [];
  for (const kind of Object.keys(COUNTS)) {
    const rnd = random(hash(`${seed}\n${kind}`)), count = COUNTS[kind](n);
    w[kind] = Array.from({ length: count }, () => MAKE[kind](rnd));
    key.push(count);
  }
  w.key = `${hash(seed)}:${key.join(',')}`;
  return w;
}
