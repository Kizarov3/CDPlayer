import test from 'node:test';
import assert from 'node:assert';
import { spatialMix, roomImpulse, Spatializer, CROSSFEED_CUTOFF, CROSSFEED_DELAY } from '../src/renderer/js/spatial.js';

// Just enough Web Audio to build the effect and read back how it's wired and what it set.
const param = (v = 1) => ({ value: v, setTargetAtTime(x) { this.value = x; } });
function fakeContext() {
  const made = { links: [], filters: [], delays: [], convolvers: [] };
  const node = (kind, extra = {}) => ({ kind, gain: param(), ...extra, connect(to, out = 0, inp = 0) { made.links.push({ from: this, to, out, inp }); return to; } });
  const ctx = {
    sampleRate: 48000, currentTime: 0, made,
    createGain: () => node('gain'),
    createChannelSplitter: () => (made.splitter = node('splitter')),
    createChannelMerger: () => (made.merger = node('merger')),
    createBiquadFilter: () => { const f = node('filter', { frequency: param(350), Q: param(1), type: 'lowpass' }); made.filters.push(f); return f; },
    createDelay: () => { const d = node('delay', { delayTime: param(0) }); made.delays.push(d); return d; },
    createConvolver: () => { const c = node('convolver'); made.convolvers.push(c); return c; },
    createBuffer: (channels, length, sampleRate) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { numberOfChannels: channels, length, sampleRate, getChannelData: (c) => data[c] };
    },
  };
  return ctx;
}
const db = (g) => 20 * Math.log10(g);

test('off: the music passes straight through, nothing else heard', () => {
  assert.deepStrictEqual(spatialMix(false, 0.7), { dry: 1, speakers: 0, cross: 0, room: 0 });
});

test('on: each ear gets the other side quieter, more of it and more room as the amount goes up, never louder overall', () => {
  const low = spatialMix(true, 0), high = spatialMix(true, 1);
  assert.strictEqual(low.dry, 0);
  assert.ok(db(low.cross) <= -9 && db(low.cross) >= -10, 'light: about −9.5 dB');
  assert.ok(db(high.cross) >= -5 && db(high.cross) <= -4, 'strong: about −4.5 dB, as bs2b');
  assert.ok(high.room > low.room && high.room <= 0.15, 'a little room, never a hall');
  for (const m of [low, high]) assert.ok(m.speakers * (1 + m.cross) <= 1.25, 'no big jump in loudness');
  assert.deepStrictEqual(spatialMix(true, 5), spatialMix(true, 1), 'amount clamped');
  assert.deepStrictEqual(spatialMix(true, -1), spatialMix(true, 0));
});

test('the room: a short, bright stereo tail that starts after a moment, dies away, and is the same every time', () => {
  const a = roomImpulse(fakeContext()), b = roomImpulse(fakeContext());
  assert.strictEqual(a.numberOfChannels, 2);
  const l = a.getChannelData(0), r = a.getChannelData(1);
  assert.ok(a.length > 48000 * 0.15 && a.length < 48000 * 0.5, 'a small room, not a hall');
  assert.strictEqual(l[0], 0, 'a moment of silence before the first reflection');
  const energy = (d, from, to) => { let s = 0; for (let i = from; i < to; i++) s += d[i] * d[i]; return s; };
  const q = Math.floor(a.length / 4);
  assert.ok(energy(l, q, 2 * q) > 10 * energy(l, 3 * q, 4 * q), 'it dies away');
  assert.notDeepStrictEqual(Array.from(l.slice(1000, 1010)), Array.from(r.slice(1000, 1010)), 'left and right differ: width');
  assert.deepStrictEqual(Array.from(l.slice(0, 2000)), Array.from(b.getChannelData(0).slice(0, 2000)), 'the same room each time');
  assert.ok(Math.abs(energy(l, 0, a.length) + energy(r, 0, a.length) - 1) < 1e-6, 'normalised, so the room level is the mix\'s');
  // Bright, not muffled: sample-to-sample changes are as big as the samples themselves (white-ish), not tiny (dark).
  let diff = 0, sum = 0;
  for (let i = 1000; i < 3000; i++) { diff += (l[i] - l[i - 1]) ** 2; sum += l[i] ** 2; }
  assert.ok(diff / sum > 0.5, 'treble kept');
});

test('crossfeed: the right channel, low-passed and a fraction of a millisecond late, reaches the left ear — and the other way round', () => {
  const ctx = fakeContext();
  new Spatializer(ctx);
  const { links, splitter, merger, filters, delays } = ctx.made;
  const path = (channel, ear) => {
    const f = links.find((k) => k.from === splitter && k.out === channel && k.to.kind === 'filter');
    const d = f && links.find((k) => k.from === f.to && k.to.kind === 'delay');
    const g = d && links.find((k) => k.from === d.to && k.to.kind === 'gain');
    return !!(g && links.find((k) => k.from === g.to && k.to === merger && k.inp === ear));
  };
  assert.ok(path(1, 0), 'right → left ear');
  assert.ok(path(0, 1), 'left → right ear');
  assert.strictEqual(filters.length, 2);
  for (const f of filters) { assert.strictEqual(f.type, 'lowpass'); assert.strictEqual(f.frequency.value, CROSSFEED_CUTOFF); }
  for (const d of delays) assert.strictEqual(d.delayTime.value, CROSSFEED_DELAY);
  assert.ok(CROSSFEED_DELAY > 0.0002 && CROSSFEED_DELAY < 0.0006, 'about the time sound takes round a head');
  const direct = (channel, ear) => links.some((k) => k.from === splitter && k.out === channel && k.to === merger && k.inp === ear);
  assert.ok(direct(0, 0) && direct(1, 1), 'each ear keeps its own channel whole, unfiltered');
});

test('set(): the levels it was given', () => {
  const s = new Spatializer(fakeContext());
  assert.strictEqual(s.dry.gain.value, 1, 'starts off');
  s.set(true, 1);
  const m = spatialMix(true, 1);
  assert.deepStrictEqual([s.dry.gain.value, s.speakers.gain.value, s.room.gain.value], [m.dry, m.speakers, m.room]);
  assert.deepStrictEqual(s.cross.map((g) => g.gain.value), [m.cross, m.cross]);
});
