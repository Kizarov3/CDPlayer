// Settings → SOUND CHECK: each song's gain to -18 LUFS (loudness.js) — from its ReplayGain tags, else from the cache of
// songs measured before (soundcheck-cache.js), else measured now, one file at a time. ALBUM evens out whole albums (the
// shelf's), keeping an album's quiet and loud songs as they were made; until all of an album is known, its song's own.
import { integratedLoudness, levelFromLoudness, albumLevel, trimFor, MAX_MEASURE_SECONDS } from './loudness.js';

// Chromium decodes a file at its own rate before resampling it to 16 kHz: a 15-minute 192 kHz file would be ~1.4 GB of
// samples in the renderer. Files that would decode to more than this (as stereo floats) are left to their tags.
const MAX_DECODE_BYTES = 400e6;

/** Decodes `url` at 16 kHz (as computeWaveform does at 8) and measures it → { loudness, peak, duration }. */
export async function measureFile(url) {
  const buf = await (await fetch(url)).arrayBuffer();
  const audio = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(buf);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
  return { ...integratedLoudness(channels, audio.sampleRate), duration: audio.duration };
}

/**
 * `details(path)` → a track's details (its replayGain, duration and cue), `cache` → { get(files), put(file, entry),
 * album(path) → the shelf album's paths or null }, `measure(file)` → { loudness, peak, duration }.
 */
export function createSoundCheck({ details, cache, measure }) {
  let current = 0;
  const failed = new Set();
  let queue = Promise.resolve(); // one file decoded at a time

  const fileOf = (d, p) => (d && d.cue ? d.cue.file : p);
  const info = (level, source, scope) => (level ? { ...trimFor(level), source, scope } : null);
  // What would be decoded — a cue track's whole album file — and whether that's safe to: { duration, rate }.
  const fileSize = async (d) => {
    const f = d && d.cue ? (await details(d.cue.file)) || {} : d || {};
    return { duration: f.duration, rate: (f.format && f.format.sampleRate) || 48000 };
  };

  async function trackLevel(p) {
    const d = await details(p);
    const rg = d && d.replayGain;
    if (rg && rg.trackGain !== null) return { level: { gain: rg.trackGain, peak: rg.trackPeak || 1 }, source: 'TAGS', d };
    const file = fileOf(d, p), got = (await cache.get([file]))[file];
    return { level: got ? levelFromLoudness(got) : null, source: 'MEASURED', d, file };
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

  // `wanted()` is asked again when the job's turn comes: an album's songs queued for a song since left are skipped.
  function measureOnce(file, { duration, rate }, wanted = () => true) {
    if (failed.has(file) || !(duration > 0) || duration > MAX_MEASURE_SECONDS || duration * rate * 2 * 4 > MAX_DECODE_BYTES) return Promise.resolve(null);
    const job = queue.then(async () => {
      if (!wanted()) return null;
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
    /**
     * Measures what the song (and in ALBUM, its album) still needs, calling apply(info, ramp) as each answer is better.
     * → what it settled on, or null: nothing to go by (silence, a file it can't or won't decode), or another song followed.
     */
    async follow(p, mode, apply) {
      const token = ++current;
      if (mode === 'OFF') return null;
      const live = () => token === current;
      const t = await trackLevel(p);
      let settled = info(t.level, t.source, 'TRACK'), measuredNow = false;
      if (!t.level && t.source === 'MEASURED') {
        const m = await measureOnce(t.file, await fileSize(t.d));
        const level = m ? levelFromLoudness(m) : null;
        if (level && live()) { settled = info(level, 'MEASURED', 'TRACK'); apply(settled, 1); measuredNow = true; }
      }
      if (!live()) return null;
      if (mode !== 'ALBUM') return settled;
      let album = await albumLevelOf(p, t.d);
      if (album) { if (!live()) return null; apply(album, measuredNow ? 2 : 0); return album; }
      const paths = await cache.album(p);
      if (!paths) return live() ? settled : null;
      for (const q of paths) {
        if (!live()) return null; // moved on: what's measured so far is kept
        const d = await details(q);
        await measureOnce(fileOf(d, q), await fileSize(d), live);
      }
      album = await albumLevelOf(p, t.d);
      if (!live()) return null;
      if (album) { apply(album, 2); return album; }
      return settled;
    },
  };
}
