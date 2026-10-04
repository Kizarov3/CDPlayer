# Sound Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings → SOUND CHECK (OFF / ALBUM / TRACK) plays every song at −18 LUFS, from its ReplayGain tags or a one-time BS.1770 measurement.

**Architecture:** A pure loudness module (`loudness.js`) measures decoded samples; a renderer controller (`sound-check.js`) finds each track's level (tags → cache → measure) and hands a linear gain to a new per-deck `trim` GainNode in `AudioEngine`. Measurements are cached in the main process (`soundcheck-cache.js`, `soundcheck.json`).

**Tech Stack:** Electron 44 (castLabs), Web Audio (`OfflineAudioContext.decodeAudioData`), music-metadata 11, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-04-sound-check-design.md`

## Global Constraints

- Default `OFF`; modes `OFF`, `TRACK`, `ALBUM`; stored as line 24 (index 23) of `settings.txt`; missing/unknown → `OFF`.
- Target −18 LUFS. Gain capped at `0.944 / peak` (−0.5 dB margin). No limiter.
- Measure at 16 kHz; never measure files longer than 20 minutes (1200 s) — tags only for those.
- Not applied to Spotify tracks or live audio-CD tracks (`isAudioCdTrack`).
- Ramps: first measurement 1 s, switch to album gain 2 s, settings change 0.5 s, known-at-load 0 s.
- Tests never touch a real `~/.cdplayer`: set `process.env.CDPLAYER_HOME` to a temp dir (see `test/state.test.js`).
- Commit messages in the repo's style (a plain sentence of what changed); no AI attribution lines.
- Every new UI string goes through `t()` and gets a Russian translation in `src/locales/ru.json` (`npm run i18n -- ru` adds the keys).

## Review Focus

- A track changed while its file is still being measured: the late result must not set the trim of the next track → Task 5 test "a measurement that lands after the track changed is not applied".
- A file that can't be decoded (corrupt, unsupported): no exception loop, plays at 1.0, not retried this session → Task 5 test "a file that fails to measure is skipped".
- Silence or near-silence (`loudness = -Infinity`): no `Infinity` gain → Task 1 test "silence gives no gain".
- Crossfade into a measured track: the incoming deck's trim must not be reset by `cancelCrossfade`/fade curves → Task 4 test "trim survives the crossfade curves".
- A cue album (many refs, one file): measured once, by its file → Task 5 test "cue tracks share their file's measurement".

---

### Task 1: Loudness measurement (pure)

**Files:**
- Create: `src/renderer/js/loudness.js`
- Test: `test/loudness.test.mjs`

**Interfaces:**
- Produces:
  - `TARGET_LUFS = -18`, `MAX_MEASURE_SECONDS = 1200`
  - `kWeighting(sampleRate) → [{ b: [b0,b1,b2], a: [1,a1,a2] }, { b, a }]`
  - `integratedLoudness(channels: Float32Array[], sampleRate) → { loudness: number (LUFS, -Infinity for silence), peak: number }`
  - `levelFromLoudness({ loudness, peak }) → { gain: dB, peak } | null` (null for -Infinity)
  - `albumLevel(entries: {loudness, peak, duration}[]) → { gain, peak } | null`
  - `trimFor({ gain, peak }) → { linear, db, limited }`

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test';
import assert from 'node:assert';
import { kWeighting, integratedLoudness, levelFromLoudness, albumLevel, trimFor, TARGET_LUFS } from '../src/renderer/js/loudness.js';

const sine = (hz, db, rate, seconds) => {
  const a = 10 ** (db / 20), n = Math.round(rate * seconds), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = a * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
};
const mix = (rate, seconds) => { // band-limited below 8 kHz, so 16 kHz and 48 kHz see the same signal
  const n = Math.round(rate * seconds), out = new Float32Array(n);
  for (const [hz, a] of [[60, 0.2], [220, 0.2], [1000, 0.15], [3000, 0.1], [6000, 0.05]]) for (let i = 0; i < n; i++) out[i] += a * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
};
const close = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test('K-weighting at 48 kHz matches BS.1770 table 1 and 2', () => {
  const [shelf, hp] = kWeighting(48000);
  [1.53512485958697, -2.69169618940638, 1.19839281085285].forEach((v, i) => close(shelf.b[i], v, 1e-6));
  [1, -1.69065929318241, 0.73248077421585].forEach((v, i) => close(shelf.a[i], v, 1e-6));
  [1, -2, 1].forEach((v, i) => close(hp.b[i], v, 1e-6));
  [1, -1.99004745483398, 0.99007225036621].forEach((v, i) => close(hp.a[i], v, 1e-6));
});

test('a 1 kHz sine at 0 dBFS in one channel is -3.01 LUFS', () => {
  const r = integratedLoudness([sine(1000, 0, 48000, 5), new Float32Array(48000 * 5)], 48000);
  close(r.loudness, -3.01, 0.1);
  close(r.peak, 1, 1e-3);
});

test('a 1 kHz sine at -20 dBFS in both channels is -20 LUFS', () => {
  const s = sine(1000, -20, 48000, 5);
  close(integratedLoudness([s, s], 48000).loudness, -20, 0.1);
});

test('measured at 16 kHz, the same music is within 0.5 LU of 48 kHz', () => {
  const hi = integratedLoudness([mix(48000, 10), mix(48000, 10)], 48000).loudness;
  const lo = integratedLoudness([mix(16000, 10), mix(16000, 10)], 16000).loudness;
  close(lo, hi, 0.5);
});

test('gating ignores silence around the music', () => {
  const s = sine(1000, -20, 48000, 5), quiet = new Float32Array(48000 * 20);
  const padded = new Float32Array(s.length + quiet.length * 2); padded.set(s, quiet.length);
  close(integratedLoudness([padded, padded], 48000).loudness, -20, 0.2);
});

test('silence gives no gain', () => {
  const z = new Float32Array(48000);
  const r = integratedLoudness([z, z], 48000);
  assert.strictEqual(r.loudness, -Infinity);
  assert.strictEqual(levelFromLoudness(r), null);
});

test('a level is the distance to -18 LUFS', () => {
  assert.deepStrictEqual(levelFromLoudness({ loudness: -10, peak: 1 }), { gain: -8, peak: 1 });
  assert.strictEqual(TARGET_LUFS, -18);
});

test('a boost stops at the peak, with half a dB to spare', () => {
  const t = trimFor({ gain: 6, peak: 0.9 });
  close(t.linear, 0.944 / 0.9, 1e-9);
  assert.strictEqual(t.limited, true);
  const cut = trimFor({ gain: -6, peak: 1 });
  close(cut.linear, 10 ** (-6 / 20), 1e-9);
  assert.strictEqual(cut.limited, false);
  close(cut.db, -6, 1e-9);
});

test('an album is the power mean of its songs, weighted by length, at its highest peak', () => {
  const a = albumLevel([{ loudness: -10, peak: 0.5, duration: 100 }, { loudness: -20, peak: 0.9, duration: 100 }]);
  close(a.gain, -18 - 10 * Math.log10((10 ** -1 + 10 ** -2) / 2), 1e-9);
  assert.strictEqual(a.peak, 0.9);
  assert.strictEqual(albumLevel([]), null);
  assert.strictEqual(albumLevel([{ loudness: -Infinity, peak: 0, duration: 10 }]), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/loudness.test.mjs`
Expected: FAIL — `Cannot find module '…/loudness.js'`.

- [ ] **Step 3: Implement `src/renderer/js/loudness.js`**

```js
// Sound Check's loudness: ITU-R BS.1770 integrated loudness (K-weighting, 400 ms blocks, the -70 LUFS and -10 LU
// gates) of a decoded song, and the gain that brings it to -18 LUFS — ReplayGain 2's reference, so a file's own
// ReplayGain tags and these measurements agree. Pure, for node --test.

export const TARGET_LUFS = -18;
export const MAX_MEASURE_SECONDS = 1200; // longer files (cue images, mixes) only by their tags: decoding them whole costs hundreds of MB
const PEAK_ROOM = 0.944; // -0.5 dB: the peak is measured on a resampled copy

/** BS.1770's two biquads — a high shelf (the head) and a high pass — worked out for any rate, as libebur128 does. */
export function kWeighting(sampleRate) {
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = 10 ** (G / 20), Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf = {
    b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  };
  f0 = 38.13547087602444; Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + K / Q + K * K;
  const hp = { b: [1, -2, 1], a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  return [shelf, hp];
}

/** Each 100 ms stretch's K-weighted energy (summed over channels), and the highest sample. */
function stepEnergies(channels, sampleRate) {
  const step = Math.round(sampleRate / 10), n = channels[0] ? channels[0].length : 0, steps = Math.floor(n / step);
  const energy = new Float64Array(steps);
  const [s, h] = kWeighting(sampleRate);
  let peak = 0;
  for (const x of channels) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, z1 = 0, z2 = 0;
    for (let i = 0; i < steps * step; i++) {
      const v = x[i];
      const a = Math.abs(v); if (a > peak) peak = a;
      const y = s.b[0] * v + s.b[1] * x1 + s.b[2] * x2 - s.a[1] * y1 - s.a[2] * y2;
      x2 = x1; x1 = v;
      const z = h.b[0] * y + h.b[1] * y1 + h.b[2] * y2 - h.a[1] * z1 - h.a[2] * z2;
      y2 = y1; y1 = y; z2 = z1; z1 = z;
      energy[Math.floor(i / step)] += z * z;
    }
  }
  return { energy, step, peak };
}

const lufs = (meanSquare) => -0.691 + 10 * Math.log10(meanSquare);

/** BS.1770 integrated loudness of `channels` (left, right…, weighted 1) → { loudness, peak }. */
export function integratedLoudness(channels, sampleRate) {
  const { energy, step, peak } = stepEnergies(channels, sampleRate);
  const blocks = [];
  for (let i = 0; i + 4 <= energy.length; i++) blocks.push((energy[i] + energy[i + 1] + energy[i + 2] + energy[i + 3]) / (4 * step));
  const loud = blocks.filter((z) => z > 0 && lufs(z) > -70);
  if (!loud.length) return { loudness: -Infinity, peak };
  const relative = lufs(loud.reduce((a, z) => a + z, 0) / loud.length) - 10;
  const gated = loud.filter((z) => lufs(z) > relative);
  return { loudness: lufs(gated.reduce((a, z) => a + z, 0) / gated.length), peak };
}

/** A measured song → its level: the gain (dB) to -18 LUFS and its peak. Silence → null. */
export function levelFromLoudness({ loudness, peak }) {
  return Number.isFinite(loudness) ? { gain: TARGET_LUFS - loudness, peak } : null;
}

/** An album's level from its songs' measurements: the power mean of their loudness, weighted by length; the highest peak. */
export function albumLevel(entries) {
  const ok = entries.filter((e) => Number.isFinite(e.loudness) && e.duration > 0);
  if (!ok.length) return null;
  const total = ok.reduce((a, e) => a + e.duration, 0);
  const power = ok.reduce((a, e) => a + e.duration * 10 ** (e.loudness / 10), 0) / total;
  return { gain: TARGET_LUFS - 10 * Math.log10(power), peak: Math.max(...ok.map((e) => e.peak || 0)) };
}

/** A level → the deck's gain: lowered as far as asked, raised only as far as the peak allows. */
export function trimFor({ gain, peak }) {
  const wanted = 10 ** (gain / 20), room = peak > 0 ? PEAK_ROOM / peak : Infinity;
  const linear = Math.min(wanted, room);
  return { linear, db: 20 * Math.log10(linear), limited: room < wanted };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/loudness.test.mjs`
Expected: PASS (9 tests). If the 16 kHz check is off by more than 0.5 LU, investigate the filter (don't widen the tolerance).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/js/loudness.js test/loudness.test.mjs
git commit -m "Sound Check's loudness: BS.1770 integrated loudness of a song, and the gain that brings it to -18 LUFS without clipping"
```

---

### Task 2: The SOUND CHECK setting is stored

**Files:**
- Modify: `src/main/store.js:60-118` (comment, `DEFAULT_SETTINGS`, `readSettings`, `writeSettings`)
- Test: `test/state.test.js`

**Interfaces:**
- Produces: `settings.soundCheck: 'OFF' | 'TRACK' | 'ALBUM'` in `state:load`'s `settings` and accepted by `state:saveSettings`.

- [ ] **Step 1: Write the failing test** — append to `test/state.test.js`, and add `soundCheck: 'OFF'` to the expected object of the first test ('reads a settings.txt written by the Java version'):

```js
test('SOUND CHECK is off unless turned on, and survives a save', () => {
  fs.writeFileSync(path.join(home, 'settings.txt'), '70\n5\n1\n0\nOCEAN\n0,0,0,0,0,0,0,0,0,0\n0\n0\n\n0\n1\n');
  assert.strictEqual(store.readSettings().soundCheck, 'OFF');
  for (const mode of ['ALBUM', 'TRACK', 'OFF']) {
    store.writeSettings({ ...store.readSettings(), soundCheck: mode });
    assert.strictEqual(store.readSettings().soundCheck, mode);
  }
  store.writeSettings({ ...store.readSettings(), soundCheck: 'LOUD' });
  assert.strictEqual(store.readSettings().soundCheck, 'OFF');
});
```

- [ ] **Step 2: Run** `node --test test/state.test.js` — Expected: FAIL (`soundCheck` undefined).

- [ ] **Step 3: Implement** in `src/main/store.js`:
  - Comment: after "…the disc on the app's icon (1/0; …)" add ", and Sound Check (OFF, TRACK or ALBUM)".
  - `DEFAULT_SETTINGS`: add `soundCheck: 'OFF'` after `taskbarDisc`.
  - Next to `QUALITIES`: `const SOUND_CHECKS = ['OFF', 'TRACK', 'ALBUM'];`
  - `readSettings`, after the `taskbarDisc` line:
    ```js
    s.soundCheck = l.length >= 24 && SOUND_CHECKS.includes(l[23].trim()) ? l[23].trim() : 'OFF';
    ```
  - `writeSettings`: append `, SOUND_CHECKS.includes(s.soundCheck) ? s.soundCheck : 'OFF'` after `s.taskbarDisc ? 1 : 0` in the array.

- [ ] **Step 4: Run** `node --test test/state.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/store.js test/state.test.js
git commit -m "settings.txt keeps Sound Check (OFF, TRACK or ALBUM), off unless turned on"
```

---

### Task 3: ReplayGain tags in a track's details

**Files:**
- Modify: `src/main/metadata.js` (`readDetails`, the `details` object)
- Create: `test/fixtures/replaygain.flac`, `test/fixtures/r128.ogg` (generated once, committed)
- Test: `test/metadata-format.test.js`

**Interfaces:**
- Produces: `details.replayGain: { trackGain: dB|null, trackPeak: linear|null, albumGain: dB|null, albumPeak: linear|null } | null` (null when none of them is tagged). A cue track inherits its file's (it spreads `...file`).

- [ ] **Step 1: Make the fixtures**

```bash
ffmpeg -v error -i test/fixtures/smoke.flac -c copy -metadata REPLAYGAIN_TRACK_GAIN="-6.50 dB" -metadata REPLAYGAIN_TRACK_PEAK="0.988000" -metadata REPLAYGAIN_ALBUM_GAIN="-7.25 dB" -metadata REPLAYGAIN_ALBUM_PEAK="0.999000" test/fixtures/replaygain.flac
ffmpeg -v error -i test/fixtures/smoke.ogg -c copy -metadata R128_TRACK_GAIN="-512" -metadata R128_ALBUM_GAIN="256" test/fixtures/r128.ogg
```

- [ ] **Step 2: Write the failing test** (append to `test/metadata-format.test.js`):

```js
test('ReplayGain tags come with a song\'s details', async () => {
  const rg = (await metadata.getDetails(fixture('replaygain.flac'), { withCover: false })).replayGain;
  assert.ok(Math.abs(rg.trackGain - -6.5) < 1e-9);
  assert.ok(Math.abs(rg.trackPeak - 0.988) < 1e-6);
  assert.ok(Math.abs(rg.albumGain - -7.25) < 1e-9);
  assert.ok(Math.abs(rg.albumPeak - 0.999) < 1e-6);
  assert.strictEqual((await metadata.getDetails(fixture('smoke.mp3'), { withCover: false })).replayGain, null);
});

test('R128 gains (Q7.8 dB from -23 LUFS) are turned into ReplayGain\'s -18', async () => {
  const rg = (await metadata.getDetails(fixture('r128.ogg'), { withCover: false })).replayGain;
  assert.ok(Math.abs(rg.trackGain - (-512 / 256 + 5)) < 1e-9);
  assert.ok(Math.abs(rg.albumGain - (256 / 256 + 5)) < 1e-9);
  assert.strictEqual(rg.trackPeak, null);
});
```

- [ ] **Step 3: Run** `node --test test/metadata-format.test.js` — Expected: FAIL (`replayGain` undefined).

- [ ] **Step 4: Implement** in `src/main/metadata.js`. Add above `getDetails`:

```js
// Sound Check: a file's ReplayGain tags (dB to -18 LUFS, peaks linear), or an Opus/Vorbis file's R128 gains — Q7.8 dB
// to -23 LUFS, so 5 dB more. → null when it has none.
function replayGainFrom(meta) {
  const c = meta.common || {}, num = (v) => (Number.isFinite(v) ? v : null);
  const out = {
    trackGain: num(c.replaygain_track_gain && c.replaygain_track_gain.dB), trackPeak: num(c.replaygain_track_peak && c.replaygain_track_peak.ratio),
    albumGain: num(c.replaygain_album_gain && c.replaygain_album_gain.dB), albumPeak: num(c.replaygain_album_peak && c.replaygain_album_peak.ratio),
  };
  for (const tags of Object.values(meta.native || {})) {
    for (const { id, value } of tags) {
      const q = parseInt(value, 10);
      if (!Number.isFinite(q)) continue;
      if (/^R128_TRACK_GAIN$/i.test(id) && out.trackGain === null) out.trackGain = q / 256 + 5;
      if (/^R128_ALBUM_GAIN$/i.test(id) && out.albumGain === null) out.albumGain = q / 256 + 5;
    }
  }
  return Object.values(out).some((v) => v !== null) ? out : null;
}
```

In `readDetails`: declare `let replayGain = null` with the other `let`s; inside the `try` after `format = meta.format;` add `replayGain = replayGainFrom(meta);`; add `replayGain,` to the `details` object after `format`. In `cdTrackDetails` add `replayGain: null`.

- [ ] **Step 5: Run** `node --test test/metadata-format.test.js` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/metadata.js test/metadata-format.test.js test/fixtures/replaygain.flac test/fixtures/r128.ogg
git commit -m "A song's details carry its ReplayGain tags, or its R128 gains turned into ReplayGain's"
```

---

### Task 4: A trim on every deck

**Files:**
- Modify: `src/renderer/js/audio.js` (`createDeck`, `disposeDeck`, `load`, new `setTrim`; the graph comment at the top)
- Test: `test/audio-element-deck.test.mjs`

**Interfaces:**
- Produces: `engine.load(url, { …, trim = 1 })`; `engine.setTrim(linear, rampSeconds = 0)` on the current deck; `deck.trim` (GainNode or null for a supplied element).

- [ ] **Step 1: Write the failing tests** (append to `test/audio-element-deck.test.mjs`; the fake `AudioContext` there throws on `createMediaElementSource`, so give these tests their own subclass):

```js
class RoutedContext extends globalThis.AudioContext { createMediaElementSource() { return { connect() {}, disconnect() {} }; } }
const routedEngine = () => { const e = new AudioEngine(); e.ctx = new RoutedContext(); return e; };
globalThis.Audio = class extends FakeElement {};

test('a deck starts at the trim it was loaded with, and setTrim changes it', async () => {
  const engine = routedEngine();
  await engine.load('cdp://app/media?p=a', { autoPlay: false, trim: 0.5 });
  assert.strictEqual(engine.deck.trim.gain.value, 0.5);
  let target = null;
  engine.deck.trim.gain.setTargetAtTime = (v) => { target = v; };
  engine.setTrim(0.25, 1);
  assert.strictEqual(target, 0.25);
  engine.setTrim(0.75);
  assert.strictEqual(engine.deck.trim.gain.value, 0.75);
});

test('trim survives the crossfade curves', async () => {
  const engine = routedEngine();
  await engine.load('cdp://app/media?p=a', { autoPlay: true, trim: 0.5 });
  await engine.load('cdp://app/media?p=b', { autoPlay: false, crossfadeSeconds: 2, trim: 0.3 });
  engine.cancelCrossfade();
  assert.strictEqual(engine.deck.trim.gain.value, 0.3);
  assert.strictEqual(engine.deck.gain.gain.value, 1);
});

test('a supplied element has no trim, and setTrim leaves it alone', async () => {
  const engine = new AudioEngine();
  await engine.load('spotify:track:A', { autoPlay: false, element: new FakeElement() });
  assert.strictEqual(engine.deck.trim, null);
  engine.setTrim(0.5); // no throw
});
```

(Check `engine.ctx` is the property name the engine uses for its context — it is: `this.ctx` in `audio.js`. If `load` reads `this.ctx` before the test swaps it, construct then swap as above before the first `load`.)

- [ ] **Step 2: Run** `node --test test/audio-element-deck.test.mjs` — Expected: FAIL (`deck.trim` undefined).

- [ ] **Step 3: Implement** in `src/renderer/js/audio.js`:
  - Top comment graph: `//   deck → trim (Sound Check) → deck gain (crossfade) ─┐` for both deck lines.
  - `createDeck(url, element = null, trim = 1)`:
    ```js
    const gain = this.ctx.createGain();
    let trimNode = null;
    if (!element) {
      el.preload = 'auto';
      el.src = url;
      source = this.ctx.createMediaElementSource(el);
      trimNode = this.ctx.createGain();
      trimNode.gain.value = trim;
      source.connect(trimNode);
      trimNode.connect(gain);
      gain.connect(this.input);
    }
    const deck = { el, source, trim: trimNode, gain, url, start: 0, end: null, endFired: false };
    ```
  - `disposeDeck`: after `if (deck.source) deck.source.disconnect();` add `if (deck.trim) deck.trim.disconnect();`.
  - `load(url, { autoPlay = true, crossfadeSeconds = 0, segment = null, element = null, trim = 1 } = {})` and `this.createDeck(url, element, trim)`.
  - New method after `setVolume`:
    ```js
    /** Sound Check: the playing deck's own gain, before the crossfade's (1 = as it is). Ramped over `seconds`. */
    setTrim(linear, seconds = 0) {
      const t = this.deck && this.deck.trim;
      if (!t) return;
      t.gain.cancelScheduledValues(this.ctx.currentTime);
      if (seconds > 0) t.gain.setTargetAtTime(linear, this.ctx.currentTime, seconds / 3);
      else t.gain.value = linear;
    }
    ```
  - Check `setRate` (rebuilds the graph in a new context): it disposes the decks, so nothing to carry; Task 6 re-applies the trim on the next `load`.

- [ ] **Step 4: Run** `node --test test/audio-element-deck.test.mjs test/audio-rate.test.mjs` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/js/audio.js test/audio-element-deck.test.mjs
git commit -m "Each deck has a trim of its own before the crossfade's gain, for Sound Check"
```

---

### Task 5: The measurement cache and the Sound Check controller

**Files:**
- Create: `src/main/soundcheck-cache.js`, `src/renderer/js/sound-check.js`
- Modify: `src/main/main.js` (IPC next to `plays:*`), `src/preload.js` (next to `shelfAlbums`)
- Test: `test/soundcheck-cache.test.js`, `test/sound-check.test.mjs`

**Interfaces:**
- Consumes: Task 1 `levelFromLoudness`, `albumLevel`, `trimFor`, `MAX_MEASURE_SECONDS`; Task 3 `details.replayGain`; `shelf.albumOf(p) → { id, paths } | null`.
- Produces:
  - main: `createSoundCheckCache({ read, write, stat, delayMs = 1000 })` → `{ get(files) → { [file]: entry }, put(file, { loudness, peak, duration }) }`.
  - IPC/preload: `cdp.soundCheck.get(files)`, `cdp.soundCheck.put(file, entry)`, `cdp.soundCheck.album(path) → paths[] | null`.
  - renderer: `createSoundCheck({ details, cache, measure })` → `{ known(path, mode) → Promise<Info|null>, follow(path, mode, apply) }` where `Info = { linear, db, limited, source: 'TAGS'|'MEASURED', scope: 'TRACK'|'ALBUM' }`, `apply(info, rampSeconds)`; `measureFile(url) → Promise<{ loudness, peak, duration }>`.

- [ ] **Step 1: Write the failing cache test** `test/soundcheck-cache.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createSoundCheckCache } = require('../src/main/soundcheck-cache');

const setup = (stats, text = null) => {
  const writes = [];
  const cache = createSoundCheckCache({ read: () => text, write: (s) => writes.push(JSON.parse(s)), stat: (f) => stats[f] || null, delayMs: 0 });
  return { cache, writes };
};

test('an entry is kept with its file\'s size and date, and dropped once the file changes', async () => {
  const stats = { '/a.flac': { size: 10, mtimeMs: 1000 } };
  const { cache, writes } = setup(stats);
  cache.put('/a.flac', { loudness: -12, peak: 0.9, duration: 200 });
  assert.deepStrictEqual(cache.get(['/a.flac', '/b.flac']), { '/a.flac': { loudness: -12, peak: 0.9, duration: 200 } });
  await new Promise((r) => setTimeout(r, 5));
  assert.strictEqual(writes.length, 1);
  assert.deepStrictEqual(writes[0].tracks['/a.flac'], { stamp: '10:1000', loudness: -12, peak: 0.9, duration: 200 });
  stats['/a.flac'] = { size: 11, mtimeMs: 2000 };
  assert.deepStrictEqual(cache.get(['/a.flac']), {});
});

test('a saved cache is read back, and a broken one is ignored', () => {
  const stats = { '/a.flac': { size: 10, mtimeMs: 1000 } };
  const saved = JSON.stringify({ version: 1, tracks: { '/a.flac': { stamp: '10:1000', loudness: -9, peak: 1, duration: 3 } } });
  assert.strictEqual(setup(stats, saved).cache.get(['/a.flac'])['/a.flac'].loudness, -9);
  assert.deepStrictEqual(setup(stats, '{nope').cache.get(['/a.flac']), {});
});

test('silence is stored as null loudness and read back as -Infinity', () => {
  const stats = { '/s.wav': { size: 1, mtimeMs: 1 } };
  const { cache } = setup(stats);
  cache.put('/s.wav', { loudness: -Infinity, peak: 0, duration: 5 });
  assert.strictEqual(cache.get(['/s.wav'])['/s.wav'].loudness, -Infinity);
});
```

- [ ] **Step 2: Run** `node --test test/soundcheck-cache.test.js` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/main/soundcheck-cache.js`**

```js
'use strict';
/**
 * Sound Check's measurements (sound-check.js in the renderer), kept in soundcheck.json in the data folder so a song is
 * measured once: { version, tracks: { [file]: { stamp, loudness, peak, duration } } }. `stamp` is the file's
 * "size:mtime", as in the shelf's cache — a changed file is measured again. Silence's -Infinity is kept as null.
 */
const VERSION = 1;

function createSoundCheckCache({ read, write, stat, delayMs = 1000 }) {
  let tracks = null, timer = null;
  const load = () => {
    if (tracks) return tracks;
    try { const j = JSON.parse(read() || ''); tracks = j && j.version === VERSION && j.tracks && typeof j.tracks === 'object' ? j.tracks : {}; } catch { tracks = {}; }
    return tracks;
  };
  const stampOf = (file) => { const st = stat(file); return st ? `${st.size}:${Math.round(st.mtimeMs)}` : null; };
  const save = () => { timer = null; write(JSON.stringify({ version: VERSION, tracks })); };
  return {
    get(files) {
      const all = load(), out = {};
      for (const f of files) {
        const e = all[f];
        if (e && e.stamp === stampOf(f)) out[f] = { loudness: e.loudness === null ? -Infinity : e.loudness, peak: e.peak, duration: e.duration };
      }
      return out;
    },
    put(file, { loudness, peak, duration }) {
      const stamp = stampOf(file);
      if (!stamp) return;
      load()[file] = { stamp, loudness: Number.isFinite(loudness) ? loudness : null, peak: Number(peak) || 0, duration: Number(duration) || 0 };
      clearTimeout(timer); timer = setTimeout(save, delayMs);
    },
  };
}

module.exports = { createSoundCheckCache };
```

- [ ] **Step 4: Run** `node --test test/soundcheck-cache.test.js` — Expected: PASS.

- [ ] **Step 5: Write the failing controller test** `test/sound-check.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert';
import { createSoundCheck } from '../src/renderer/js/sound-check.js';

// A little library: details per path, an album per path, a cache, and a measure() that answers when told to.
function world({ details = {}, albums = {}, cached = {}, loudness = {} } = {}) {
  const store = { ...cached }, measured = [], waiting = [];
  const sc = createSoundCheck({
    details: async (p) => details[p] || { duration: 200, replayGain: null, cue: null },
    cache: {
      get: async (files) => Object.fromEntries(files.filter((f) => store[f]).map((f) => [f, store[f]])),
      put: async (f, e) => { store[f] = e; },
      album: async (p) => albums[p] || null,
    },
    measure: (file) => { measured.push(file); return new Promise((resolve, reject) => waiting.push({ file, go: () => (loudness[file] === 'broken' ? reject(new Error('decode')) : resolve({ loudness: loudness[file], peak: 0.5, duration: 200 })) })); },
  });
  // Answers each measurement as it's asked for, until nothing more has been asked for a few turns of the event loop.
  const flush = async () => {
    for (let idle = 0; idle < 3;) {
      await new Promise((r) => setTimeout(r, 0));
      if (waiting.length) { idle = 0; waiting.shift().go(); } else idle++;
    }
  };
  return { sc, store, measured, flush };
}
const applied = () => { const list = []; return { list, apply: (info, ramp) => list.push({ db: Math.round(info.db * 10) / 10, scope: info.scope, source: info.source, ramp }) }; };

test('OFF knows nothing and measures nothing', async () => {
  const w = world();
  assert.strictEqual(await w.sc.known('/a.flac', 'OFF'), null);
  const a = applied(); w.sc.follow('/a.flac', 'OFF', a.apply); await w.flush();
  assert.deepStrictEqual([w.measured, a.list], [[], []]);
});

test('tags are used at once, without measuring', async () => {
  const w = world({ details: { '/a.flac': { duration: 200, replayGain: { trackGain: -6, trackPeak: 0.5, albumGain: -8, albumPeak: 0.5 } } } });
  assert.deepStrictEqual((await w.sc.known('/a.flac', 'TRACK')).db.toFixed(1), '-6.0');
  assert.deepStrictEqual((await w.sc.known('/a.flac', 'ALBUM')).db.toFixed(1), '-8.0');
  assert.deepStrictEqual(w.measured, []);
});

test('an unmeasured song is measured, then ramped in over a second; then its album over two', async () => {
  const w = world({ albums: { '/a.flac': ['/a.flac', '/b.flac'] }, loudness: { '/a.flac': -10, '/b.flac': -20 } });
  assert.strictEqual(await w.sc.known('/a.flac', 'ALBUM'), null);
  const a = applied(); w.sc.follow('/a.flac', 'ALBUM', a.apply); await w.flush();
  assert.deepStrictEqual(w.measured, ['/a.flac', '/b.flac']);
  assert.deepStrictEqual(a.list[0], { db: -8, scope: 'TRACK', source: 'MEASURED', ramp: 1 });
  assert.strictEqual(a.list[1].scope, 'ALBUM'); assert.strictEqual(a.list[1].ramp, 2);
  assert.ok(await w.sc.known('/b.flac', 'ALBUM')); // the album is cached now
});

test('a measurement that lands after the track changed is not applied', async () => {
  const w = world({ loudness: { '/a.flac': -10, '/c.flac': -14 } });
  const a = applied(), c = applied();
  w.sc.follow('/a.flac', 'TRACK', a.apply);
  w.sc.follow('/c.flac', 'TRACK', c.apply);
  await w.flush();
  assert.deepStrictEqual(a.list, []);
  assert.strictEqual(c.list.length, 1);
  assert.ok(w.store['/a.flac'], 'but its measurement is still kept');
});

test('a file that fails to measure is skipped, and not tried again', async () => {
  const w = world({ loudness: { '/x.flac': 'broken' } });
  const a = applied(); w.sc.follow('/x.flac', 'TRACK', a.apply); await w.flush();
  w.sc.follow('/x.flac', 'TRACK', a.apply); await w.flush();
  assert.deepStrictEqual([w.measured, a.list], [['/x.flac'], []]);
});

test('a file over 20 minutes without tags is left as it is', async () => {
  const w = world({ details: { '/mix.flac': { duration: 3600, replayGain: null, cue: null } } });
  const a = applied(); w.sc.follow('/mix.flac', 'TRACK', a.apply); await w.flush();
  assert.deepStrictEqual([w.measured, a.list], [[], []]);
});

test('cue tracks share their file\'s measurement', async () => {
  const cue = (n) => ({ duration: 200, replayGain: null, cue: { file: '/album.flac', start: n * 200, end: n * 200 + 200 } });
  const w = world({
    details: { '/album.cue#1': cue(0), '/album.cue#2': cue(1), '/album.flac': { duration: 1000, replayGain: null, cue: null } },
    albums: { '/album.cue#1': ['/album.cue#1', '/album.cue#2'] }, loudness: { '/album.flac': -12 },
  });
  const a = applied(); w.sc.follow('/album.cue#1', 'ALBUM', a.apply); await w.flush();
  assert.deepStrictEqual(w.measured, ['/album.flac']);
  assert.strictEqual(a.list.at(-1).db, -6);
});

test('a song not on the shelf is evened out on its own in ALBUM', async () => {
  const w = world({ loudness: { '/lone.mp3': -12 } });
  const a = applied(); w.sc.follow('/lone.mp3', 'ALBUM', a.apply); await w.flush();
  assert.deepStrictEqual(a.list, [{ db: -6, scope: 'TRACK', source: 'MEASURED', ramp: 1 }]);
});
```

- [ ] **Step 6: Run** `node --test test/sound-check.test.mjs` — Expected: FAIL (module missing).

- [ ] **Step 7: Implement `src/renderer/js/sound-check.js`**

```js
// Settings → SOUND CHECK: each song's gain to -18 LUFS (loudness.js) — from its ReplayGain tags, else from the cache of
// songs measured before (soundcheck-cache.js), else measured now, one file at a time. ALBUM evens out whole albums (the
// shelf's), keeping an album's quiet and loud songs as they were made; until all of an album is known, its song's own.
import { integratedLoudness, levelFromLoudness, albumLevel, trimFor, MAX_MEASURE_SECONDS } from './loudness.js';

/** Decodes `url` at 16 kHz (as computeWaveform does at 8) and measures it → { loudness, peak, duration }. */
export async function measureFile(url) {
  const buf = await (await fetch(url)).arrayBuffer();
  const audio = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(buf);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
  return { ...integratedLoudness(channels, audio.sampleRate), duration: audio.duration };
}

export function createSoundCheck({ details, cache, measure }) {
  let current = 0;
  const failed = new Set();
  let queue = Promise.resolve(); // one file decoded at a time

  const fileOf = (d, p) => (d && d.cue ? d.cue.file : p);
  const info = (level, source, scope) => (level ? { ...trimFor(level), source, scope } : null);

  async function trackLevel(p) {
    const d = await details(p);
    const rg = d && d.replayGain;
    if (rg && rg.trackGain !== null) return { level: { gain: rg.trackGain, peak: rg.trackPeak || 1 }, source: 'TAGS', d };
    const file = fileOf(d, p), got = (await cache.get([file]))[file];
    return { level: got ? levelFromLoudness(got) : null, source: 'MEASURED', d, file, entry: got || null };
  }

  async function albumLevelOf(p, d) {
    const rg = d && d.replayGain;
    if (rg && rg.albumGain !== null) return info({ gain: rg.albumGain, peak: rg.albumPeak || rg.trackPeak || 1 }, 'TAGS', 'ALBUM');
    const paths = await cache.album(p);
    if (!paths) return null;
    const files = [...new Set(await Promise.all(paths.map(async (q) => fileOf(await details(q), q))))];
    const got = await cache.get(files);
    if (files.some((f) => !got[f])) return null;
    return info(albumLevel(files.map((f) => got[f])), 'MEASURED', 'ALBUM');
  }

  function measureOnce(file, duration) {
    if (failed.has(file) || !(duration > 0) || duration > MAX_MEASURE_SECONDS) return Promise.resolve(null);
    const job = queue.then(async () => {
      const cached = (await cache.get([file]))[file];
      if (cached) return cached;
      try { const m = await measure(file); await cache.put(file, m); return m; } catch { failed.add(file); return null; }
    });
    queue = job.catch(() => null);
    return job;
  }

  return {
    /** What's known now, without measuring: for the deck to start at. null when OFF or not known yet. */
    async known(p, mode) {
      if (mode === 'OFF') return null;
      const t = await trackLevel(p);
      if (mode === 'ALBUM') { const a = await albumLevelOf(p, t.d); if (a) return a; }
      return info(t.level, t.source, 'TRACK');
    },
    /** Measures what the song (and in ALBUM, its album) still needs, calling apply(info, ramp) as each answer is better. */
    async follow(p, mode, apply) {
      const token = ++current;
      if (mode === 'OFF') return;
      const live = () => token === current;
      const t = await trackLevel(p);
      let level = t.level;
      if (!level && t.source === 'MEASURED') {
        const m = await measureOnce(t.file, t.d && t.d.cue ? (await details(t.file)).duration : t.d && t.d.duration);
        level = m ? levelFromLoudness(m) : null;
        if (level && live()) apply(info(level, 'MEASURED', 'TRACK'), 1);
      }
      if (mode !== 'ALBUM' || !live()) return;
      if (await albumLevelOf(p, t.d)) { if (live()) apply(await albumLevelOf(p, t.d), level && !t.level ? 2 : 0); return; }
      const paths = await cache.album(p);
      if (!paths) return;
      for (const q of paths) {
        const d = await details(q), file = fileOf(d, q);
        await measureOnce(file, d && d.cue ? (await details(file)).duration : d && d.duration);
      }
      const a = await albumLevelOf(p, t.d);
      if (a && live()) apply(a, 2);
    },
  };
}
```

Note: in the "measured, then album" test the album answer comes after the track's — `ramp 2`. When everything was already known, `known()` gave the deck its trim before `load()`, and `follow` re-applies it with ramp 0 (harmless; it sets the badge).

- [ ] **Step 8: Run** `node --test test/sound-check.test.mjs` — Expected: PASS (8 tests). Fix the implementation, not the tests.

- [ ] **Step 9: Wire the IPC.** In `src/main/main.js`, after the `plays:album` handler:

```js
// Sound Check (sound-check.js): songs measured before, kept in soundcheck.json; and the shelf album a song is on.
const soundCheckCache = require('./soundcheck-cache').createSoundCheckCache({
  read: () => store.readText('soundcheck.json'),
  write: (s) => store.writeText('soundcheck.json', s),
  stat: (f) => { try { return fs.statSync(f); } catch { return null; } },
});
handle('soundcheck:get', (files) => soundCheckCache.get(Array.isArray(files) ? files.filter((f) => typeof f === 'string') : []));
handle('soundcheck:put', (file, entry) => { if (typeof file === 'string' && entry && typeof entry === 'object') soundCheckCache.put(file, entry); });
handle('soundcheck:album', (p) => { const a = shelf.albumOf(p); return a ? a.paths : null; });
```

(Check `store.readText`/`writeText` are exported — `grep -n "module.exports" src/main/store.js`; add them if not.)

In `src/preload.js` after `shelfCoverFull`:

```js
  soundCheck: { get: invoke('soundcheck:get'), put: invoke('soundcheck:put'), album: invoke('soundcheck:album') },
```

(Values are sent through IPC's structured clone: `-Infinity` survives it.)

- [ ] **Step 10: Run** `npm test` — Expected: all PASS.

- [ ] **Step 11: Commit**

```bash
git add src/main/soundcheck-cache.js src/renderer/js/sound-check.js src/main/main.js src/preload.js test/soundcheck-cache.test.js test/sound-check.test.mjs
git commit -m "Sound Check finds each song's level — its tags, a measurement kept from before, or one made now — and its album's once all of it is known"
```

---

### Task 6: Sound Check in the player, Settings and HELP

**Files:**
- Modify: `src/renderer/js/app.js` (state, `load()`, settings load/save, `setSoundCheck`, badge), `src/renderer/index.html:46`, `src/renderer/styles.css:119`, `src/renderer/js/panels.js` (Settings SOUND rows ~line 279, HELP ~line 1147), `src/locales/ru.json`, `README.md`

**Interfaces:**
- Consumes: Task 4 `engine.load(url, { trim })`, `engine.setTrim(linear, seconds)`; Task 5 `createSoundCheck`, `measureFile`, `cdp.soundCheck`; Task 2 `settings.soundCheck`.
- Produces: `app.setSoundCheck(mode)`, `app.state.soundCheck` for panels.

- [ ] **Step 1: State and controller** in `app.js`:
  - Import: `import { createSoundCheck, measureFile } from './sound-check.js';`
  - In the `state` object next to `quality: 'HIGH', rateInfo: null,` add `soundCheck: 'OFF', soundCheckInfo: null,`.
  - After `engine` is created:
    ```js
    const soundCheck = createSoundCheck({
      details: (p) => cdp.details(p, { withCover: false }).catch(() => null),
      cache: cdp.soundCheck,
      measure: (file) => measureFile(cdp.mediaUrl(file)),
    });
    const evensOut = (p) => !isSpotifyUri(p) && !isAudioCdTrack(p);
    ```
- [ ] **Step 2: In `load()`**, just before `const url = cdp.mediaUrl(cue ? cue.file : path);`:
    ```js
    const mode = evensOut(path) ? state.soundCheck : 'OFF';
    const knownLevel = await soundCheck.known(path, mode).catch(() => null);
    if (token !== state.loadToken) return;
    showSoundCheck(knownLevel);
    ```
  pass `trim: knownLevel ? knownLevel.linear : 1` in the `engine.load(url, { … })` options; in the gapless branch (`engine.setSegment(cue)`) also call `engine.setTrim(knownLevel ? knownLevel.linear : 1)`. After the try/catch block (where `startAt` is applied) add:
    ```js
    soundCheck.follow(path, mode, (info, ramp) => { if (token === state.loadToken) { engine.setTrim(info.linear, ramp); showSoundCheck(info); } });
    ```
- [ ] **Step 3: The badge.** `index.html:46` → `<div id="source-row"><span id="quality-badge" hidden></span><span id="soundcheck-badge" hidden></span><div id="track-source" …`. In `styles.css` change the `#quality-badge {` selector to `#quality-badge, #soundcheck-badge {` (both rules: the base and `.dim`). In `app.js` after `updateQualityBadge`:
    ```js
    /** SC −4.2 DB under the title while Sound Check is on: the gain the song plays at, and where it came from on hover. */
    function showSoundCheck(info) {
      state.soundCheckInfo = info;
      const badge = $('soundcheck-badge'), on = state.soundCheck !== 'OFF' && evensOut(state.loadedPath || '');
      badge.hidden = !on;
      if (!on) return;
      const db = info ? info.db : null;
      badge.textContent = db === null ? t('SC …') : t('SC {db} DB', { db: `${db > 0.05 ? '+' : db < -0.05 ? '−' : ''}${Math.abs(db).toFixed(1)}` });
      badge.title = !info ? t('SOUND CHECK · MEASURING THE SONG')
        : [t('SOUND CHECK'), info.scope === 'ALBUM' ? t('ALBUM') : t('TRACK'), info.source === 'TAGS' ? t('FROM REPLAYGAIN TAGS') : t('MEASURED'), info.limited ? t("LIMITED BY THE SONG'S PEAKS") : null].filter(Boolean).join(' · ');
    }
    ```
- [ ] **Step 4: The setting.** In `app.js`:
    ```js
    /** Settings → SOUND CHECK: OFF, TRACK or ALBUM; applied to the song playing now, over half a second. */
    async function setSoundCheck(mode) {
      state.soundCheck = ['OFF', 'TRACK', 'ALBUM'].includes(mode) ? mode : 'OFF';
      saveSettingsSoon();
      const p = state.loadedPath, token = state.loadToken;
      const m = p && evensOut(p) ? state.soundCheck : 'OFF';
      const info = p ? await soundCheck.known(p, m).catch(() => null) : null;
      if (token !== state.loadToken) return;
      engine.setTrim(info ? info.linear : 1, 0.5);
      showSoundCheck(info);
      if (p) soundCheck.follow(p, m, (i, ramp) => { if (token === state.loadToken) { engine.setTrim(i.linear, ramp); showSoundCheck(i); } });
    }
    ```
  Add `soundCheck: state.soundCheck` to the object `saveSettings` builds (line ~1480); in the settings-load block (~line 1870, next to `state.quality = s.quality || 'HIGH';`) add `state.soundCheck = s.soundCheck || 'OFF';`; export `setSoundCheck` on the `app` object passed to panels (find where `setQuality` is listed: `grep -n "setQuality," src/renderer/js/app.js`).
- [ ] **Step 5: Settings row** in `panels.js`, next to `qualityButton`:
    ```js
    const SOUND_CHECK_NAMES = { OFF: t('OFF'), ALBUM: t('ALBUM'), TRACK: t('TRACK') };
    const soundCheckButton = pill(SOUND_CHECK_NAMES[s.soundCheck] || t('OFF'), () => showMenu(soundCheckButton, ['OFF', 'ALBUM', 'TRACK'].map((mode) => ({
      label: SOUND_CHECK_NAMES[mode], current: mode === s.soundCheck,
      pick: () => app.setSoundCheck(mode).then(() => refreshSettingsIfOpen(app)),
    }))), t('Every song at the same loudness'));
    ```
  and after the SPATIAL AUDIO hint:
    ```js
    unavailable(row(t('SOUND CHECK'), soundCheckButton)),
    hint(t('Plays every song at the same loudness, from its ReplayGain tags or measured once. ALBUM keeps an album’s quiet and loud songs as they were made.')),
    ```
  (Check `s` in the settings panel is `app.state` so `s.soundCheck` reads the new field — it is used the same way for `s.quality`.)
  HELP, after the "Sound quality, as in Apple Music" line:
    ```js
    '<b>Sound Check</b>: Settings &rarr; SOUND CHECK &mdash; every song at the same loudness, from its ReplayGain tags or measured once; ALBUM keeps an album&rsquo;s own quiet and loud songs',
    ```
- [ ] **Step 6: Russian.** Run `npm run i18n -- ru`, then fill the new empty strings in `src/locales/ru.json`:
  `SOUND CHECK` → `ВЫРАВНИВАНИЕ ГРОМКОСТИ`; `ALBUM` → `АЛЬБОМ` (if not already there); `TRACK` → `ТРЕК`; `SC …` → `SC …`; `SC {db} DB` → `SC {db} ДБ`; `SOUND CHECK · MEASURING THE SONG` → `ВЫРАВНИВАНИЕ · ПЕСНЯ ИЗМЕРЯЕТСЯ`; `FROM REPLAYGAIN TAGS` → `ПО ТЕГАМ REPLAYGAIN`; `MEASURED` → `ИЗМЕРЕНО`; `LIMITED BY THE SONG'S PEAKS` → `ОГРАНИЧЕНО ПИКАМИ ПЕСНИ`; `Every song at the same loudness` → `Все песни с одинаковой громкостью`; the hint → `Все песни звучат с одинаковой громкостью — по тегам ReplayGain или по замеру, сделанному один раз. АЛЬБОМ сохраняет тихие и громкие песни альбома такими, какими их задумали.`; the HELP line → `<b>Выравнивание громкости</b>: Настройки &rarr; ВЫРАВНИВАНИЕ ГРОМКОСТИ &mdash; все песни с одинаковой громкостью, по тегам ReplayGain или по замеру; АЛЬБОМ сохраняет тихие и громкие песни альбома`. Run `npm run i18n -- ru` again: it must report 100 %.
- [ ] **Step 7: README.** In the Features list after the **Quality** bullet:
    ```md
    - **Sound Check** — every song at the same loudness (−18 LUFS), from its ReplayGain tags or measured once; **ALBUM** keeps an album's quiet and loud songs as they were made
    ```
- [ ] **Step 8: Verify.** `npm test` — all PASS (the i18n and help tests check new strings and HELP). Then run the app (`npm start`, data dir isolated: `CDPLAYER_HOME=$CLAUDE_JOB_DIR/tmp/home npm start`) and check by hand: SOUND CHECK → ALBUM, play a quiet old rip then a loud modern track on shuffle — the badge shows a positive / negative `SC` gain, the loudness jump is gone; crossfade between them works; a gapless cue album plays without gaps; OFF returns to 1.0 within half a second; Spotify and a CD show no badge.
- [ ] **Step 9: Commit**

```bash
git add src/renderer/js/app.js src/renderer/index.html src/renderer/styles.css src/renderer/js/panels.js src/locales/ru.json README.md
git commit -m "Settings → SOUND CHECK: every song at the same loudness, from its ReplayGain tags or measured once; ALBUM keeps an album's quiet and loud songs; SC and the gain under the title"
```
