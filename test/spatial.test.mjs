import test from 'node:test';
import assert from 'node:assert';
import { spatialMix, speakerPosition, roomImpulse, Spatializer, SPEAKER_ANGLE } from '../src/renderer/js/spatial.js';

// Just enough Web Audio to build the effect and read back what it set.
const param = (v = 1) => ({ value: v, setTargetAtTime(x) { this.value = x; } });
function fakeContext() {
  const made = { panners: [], convolvers: [], links: [] };
  const node = (kind) => ({ kind, gain: param(), connect(to, out = 0) { made.links.push([this, to, out]); return to; } });
  const ctx = {
    sampleRate: 48000, currentTime: 0, made,
    createGain: () => node('gain'),
    createChannelSplitter: () => node('splitter'),
    createPanner: () => { const p = { ...node('panner'), positionX: param(0), positionY: param(0), positionZ: param(0) }; made.panners.push(p); return p; },
    createConvolver: () => { const c = node('convolver'); made.convolvers.push(c); return c; },
    createBuffer: (channels, length, sampleRate) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { numberOfChannels: channels, length, sampleRate, getChannelData: (c) => data[c] };
    },
  };
  return ctx;
}

test('off: the music passes straight through, nothing else heard', () => {
  assert.deepStrictEqual(spatialMix(false, 0.7), { dry: 1, speakers: 0, center: 0, room: 0 });
});

test('on: the speakers carry it, more room and less straight centre as the amount goes up', () => {
  const low = spatialMix(true, 0), high = spatialMix(true, 1);
  assert.strictEqual(low.dry, 0);
  assert.ok(low.speakers > 0.5 && high.speakers > 0.5);
  assert.ok(high.room > low.room, 'more room');
  assert.ok(high.center < low.center, 'less of the dry centre');
  assert.deepStrictEqual(spatialMix(true, 5), spatialMix(true, 1), 'amount clamped');
  assert.deepStrictEqual(spatialMix(true, -1), spatialMix(true, 0));
});

test('the two virtual speakers stand in front, left and right, as far as each other', () => {
  const left = speakerPosition(-SPEAKER_ANGLE), right = speakerPosition(SPEAKER_ANGLE);
  assert.ok(left.x < 0 && right.x > 0);
  assert.ok(left.z < 0 && right.z < 0, 'in front of the listener (−z)');
  assert.ok(Math.abs(left.x + right.x) < 1e-9 && Math.abs(left.z - right.z) < 1e-9);
  assert.ok(Math.abs(Math.hypot(right.x, right.z) - 1) < 1e-9);
});

test('the room: a short stereo tail that starts after a moment, dies away, and is the same every time', () => {
  const a = roomImpulse(fakeContext()), b = roomImpulse(fakeContext());
  assert.strictEqual(a.numberOfChannels, 2);
  const l = a.getChannelData(0), r = a.getChannelData(1);
  assert.ok(a.length > 48000 * 0.2 && a.length < 48000 * 0.6, 'a small room, not a hall');
  assert.strictEqual(l[0], 0, 'a moment of silence before the first reflection');
  const energy = (d, from, to) => { let s = 0; for (let i = from; i < to; i++) s += d[i] * d[i]; return s; };
  const q = Math.floor(a.length / 4);
  assert.ok(energy(l, q, 2 * q) > 10 * energy(l, 3 * q, 4 * q), 'it dies away');
  assert.notDeepStrictEqual(Array.from(l.slice(1000, 1010)), Array.from(r.slice(1000, 1010)), 'left and right differ: width');
  assert.deepStrictEqual(Array.from(l.slice(0, 2000)), Array.from(b.getChannelData(0).slice(0, 2000)), 'the same room each time');
  assert.ok(Math.abs(energy(l, 0, a.length) + energy(r, 0, a.length) - 1) < 1e-6, 'normalised, so the room level is the mix\'s');
});

test('the effect: two head-related panners at the speakers, a room, and the mix it was set to', () => {
  const ctx = fakeContext();
  const s = new Spatializer(ctx);
  assert.strictEqual(ctx.made.panners.length, 2);
  for (const p of ctx.made.panners) {
    assert.strictEqual(p.panningModel, 'HRTF');
    assert.strictEqual(p.rolloffFactor, 0, 'no distance fade');
  }
  assert.deepStrictEqual(ctx.made.panners.map((p) => Math.sign(p.positionX.value)), [-1, 1], 'left channel to the left speaker');
  assert.strictEqual(ctx.made.convolvers.length, 1);
  assert.strictEqual(s.dry.gain.value, 1, 'starts off');
  s.set(true, 1);
  const m = spatialMix(true, 1);
  assert.deepStrictEqual([s.dry.gain.value, s.speakers.gain.value, s.center.gain.value, s.room.gain.value], [m.dry, m.speakers, m.center, m.room]);
});
