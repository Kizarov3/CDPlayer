// Settings → SPATIAL AUDIO: stereo on headphones heard as from speakers in front of you, instead of from inside your
// head. With speakers, each ear also hears the other speaker — a little later, and with the treble shaded off by the
// head. Crossfeed does just that (as bs2b and headphone amps' "speaker" modes do): each ear keeps its own channel
// whole, plus the other one low-passed, 0.3 ms late and quieter; a short, faint, bright room adds a sense of space.
// (Head-related panners were tried first: mixed with the plain signal they comb-filter — "like under water".)
//
//   input → split ─ L ──────────────────────────────→ merge(L) ─┐
//                  ├ R ──────────────────────────────→ merge(R) ─┼→ speakers ─┐
//                  ├ R → low-pass → 0.3 ms → cross ──→ merge(L)  │            ├→ output
//                  └ L → low-pass → 0.3 ms → cross ──→ merge(R) ─┘            │
//   input ─┬→ room (convolver) ────────────────────────────────── room ───────┤
//          └→ dry (when off) ─────────────────────────────────────────────────┘

export const CROSSFEED_CUTOFF = 700;   // Hz: what's above it is shaded off by the head
export const CROSSFEED_DELAY = 0.0003; // s: sound going round a head to the far ear

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
const fromDb = (db) => Math.pow(10, db / 20);

/** The levels of the mix, on or off, for `amount` 0–1: how much of the other side, and how much room. */
export function spatialMix(on, amount) {
  if (!on) return { dry: 1, speakers: 0, cross: 0, room: 0 };
  const a = clamp01(amount);
  const cross = fromDb(-9.5 + 5 * a); // −9.5 dB light … −4.5 dB strong (bs2b's default)
  // The crossfed lows add up with the direct ones; take a little off so switching on doesn't sound louder.
  return { dry: 0, speakers: 1 / (1 + 0.5 * cross), cross, room: 0.03 + 0.09 * a };
}

// A fixed pseudo-random sequence, so the room sounds the same every time.
function noise(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2147483648 - 1;
  };
}

/**
 * A small room's echo: after 8 ms, decaying noise — different in each ear, for width — gone by 0.3 s. Kept bright
 * (only slightly softer as it fades), since a dark echo is what makes music sound muffled. Normalised to unit energy,
 * so spatialMix sets its level.
 */
export function roomImpulse(ctx, seconds = 0.3, predelay = 0.008) {
  const rate = ctx.sampleRate, length = Math.round(rate * seconds), start = Math.round(rate * predelay);
  const buf = ctx.createBuffer(2, length, rate);
  let energy = 0;
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c), rnd = noise(c ? 0x51a7 : 0x1eaf);
    let smooth = 0;
    for (let i = start; i < length; i++) {
      const life = (i - start) / (length - start);
      smooth += (rnd() - smooth) * (1 - 0.4 * life); // barely smoothed at first, a little more as it fades
      data[i] = smooth * Math.exp(-6.9 * life); // −60 dB at the end
      energy += data[i] * data[i];
    }
  }
  const scale = energy > 0 ? 1 / Math.sqrt(energy) : 0;
  for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < length; i++) d[i] *= scale; }
  return buf;
}

/** The effect's nodes in `ctx`: connect into `input`, out of `output`; set(on, amount) fades between mixes. */
export class Spatializer {
  constructor(ctx) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    for (const name of ['dry', 'speakers', 'room']) this[name] = ctx.createGain();
    this.input.connect(this.dry); this.dry.connect(this.output);

    const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2);
    this.input.connect(split);
    split.connect(merge, 0, 0); // each ear its own channel, whole
    split.connect(merge, 1, 1);
    this.cross = [1, 0].map((from) => { // right → left ear, then left → right ear
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass'; lowpass.frequency.value = CROSSFEED_CUTOFF; lowpass.Q.value = 0.5;
      const delay = ctx.createDelay(0.01);
      delay.delayTime.value = CROSSFEED_DELAY;
      const gain = ctx.createGain();
      split.connect(lowpass, from);
      lowpass.connect(delay); delay.connect(gain);
      gain.connect(merge, 0, 1 - from);
      return gain;
    });
    merge.connect(this.speakers);
    this.speakers.connect(this.output);

    const room = ctx.createConvolver();
    room.normalize = false;
    room.buffer = roomImpulse(ctx);
    this.input.connect(room);
    room.connect(this.room);
    this.room.connect(this.output);
    this.set(false, 0, { now: true });
  }

  /** On or off, and how much; faded over a few tens of milliseconds so it never clicks. */
  set(on, amount, { now = false } = {}) {
    const mix = spatialMix(on, amount);
    const level = (g, v) => { if (now) g.value = v; else g.setTargetAtTime(v, this.ctx.currentTime, 0.03); };
    level(this.dry.gain, mix.dry);
    level(this.speakers.gain, mix.speakers);
    level(this.room.gain, mix.room);
    for (const g of this.cross) level(g.gain, mix.cross);
  }
}
