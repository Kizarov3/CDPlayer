'use strict';
// Each word of a song's lines timed by the voice: where it starts from the aligning model on the separated voice, where
// it stops from that voice itself falling silent (the model's own ends are no good on a held note).
const { maskedMono, resample, melSpectrogram } = require('./dsp');
const { linePhones, readsAsEnglish } = require('./phones');
const { alignPhones, alignSong } = require('./align');

const SONG_RATE = 44100, MODEL_RATE = 22050, VOICE_RATE = 16000;
const SECONDS_PER_FRAME = (256 / MODEL_RATE) * 3, MINUTE = MODEL_RATE * 60;
const REACH = 2.5, REACH_LATER = 0.2; // seconds a line's words may be found before its time (some are stamped late), and after the next line's
const BEFORE = 0.3, AFTER = 0.2; // seconds either side of a line's own time it's looked for in
const LEVEL_HOP = 320, LEVEL_DT = LEVEL_HOP / VOICE_RATE, AROUND = 3, SILENT_FOR = 10, UNDER = 18;

const SPLEETER = { size: 4096, hop: 1024, bins: 1024, split: 512 };

// The voice's level per 20 ms, and when it falls silent.
function voiceStops(voice) {
  const frames = Math.floor(voice.length / LEVEL_HOP), level = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = 0; i < LEVEL_HOP; i++) { const v = voice[f * LEVEL_HOP + i]; sum += v * v; }
    level[f] = 10 * Math.log10(sum / LEVEL_HOP + 1e-9);
  }
  const floor = Float32Array.from(level).sort()[Math.floor(frames * 0.9)] - UNDER;
  const voiced = (f) => { let sum = 0, n = 0; for (let g = Math.max(0, f - AROUND); g <= Math.min(frames - 1, f + AROUND); g++) { sum += level[g]; n++; } return n && sum / n > floor; };
  return (from, limit) => {
    let off = 0;
    for (let f = Math.round(from / LEVEL_DT), end = Math.min(frames, Math.round(limit / LEVEL_DT)); f < end; f++) {
      if (!voiced(f)) { if (++off >= SILENT_FOR) return (f - off + 1) * LEVEL_DT; } else off = 0;
    }
    return limit;
  };
}

/**
 * `song`: { left, right } at 44 100 Hz; `lines`: [{ time, next, words: [text] }]; `models`: { voiceMask(mags) → masks,
 * phoneProbabilities(mel, T) → { data, frames, classes } }. → per line, [{ time, end }] per word or null (left as it
 * was); or null for the whole song if its words don't read as English. `onProgress(0…1)` as it goes.
 */
async function fitWords(song, lines, models, onProgress = () => {}) {
  if (!readsAsEnglish(lines.map((l) => l.words))) return null;
  const voice = await maskedMono(song.left, song.right, SPLEETER, models.voiceMask);
  onProgress(0.5);
  const at16 = resample(voice, SONG_RATE, VOICE_RATE), stops = voiceStops(at16), at22 = resample(at16, VOICE_RATE, MODEL_RATE);
  const parts = [];
  let total = 0, classes = 0;
  for (let at = 0; at < at22.length; at += MINUTE) {
    const piece = at22.subarray(at, at + MINUTE);
    if (piece.length < MODEL_RATE) continue;
    const { data, T } = melSpectrogram(piece), out = await models.phoneProbabilities(data, T);
    parts.push(out); total += out.frames; classes = out.classes;
    onProgress(0.5 + (0.45 * at) / at22.length);
  }
  const all = new Float32Array(total * classes);
  let filled = 0;
  for (const p of parts) { all.set(p.data, filled); filled += p.data.length; }
  const parsed = lines.map((line) => linePhones(line.words));
  // The whole song in one path, each line's phones kept near its time; if it can't be done, line by line in their own times.
  const ids = [], reach = [], firstOf = [];
  parsed.forEach((p, i) => {
    firstOf.push(ids.length);
    const from = Math.max(0, Math.floor((lines[i].time - REACH) / SECONDS_PER_FRAME)), to = Math.min(total, Math.ceil((lines[i].next + REACH_LATER) / SECONDS_PER_FRAME));
    for (const id of p.ids) { ids.push(id); reach.push([from, to]); }
  });
  const whole = alignSong(all, classes, total, ids, reach);
  const timed = lines.map((line, i) => {
    const { ids: own, spans } = parsed[i];
    if (!spans.length) return null;
    if (whole) return { spans, placed: whole.slice(firstOf[i], firstOf[i] + own.length) };
    const from = Math.max(0, Math.floor((line.time - BEFORE) / SECONDS_PER_FRAME)), to = Math.min(total, Math.floor((line.next + AFTER) / SECONDS_PER_FRAME));
    const placed = to > from ? alignPhones(all, classes, from, to, own) : null;
    return placed && { spans, placed };
  });
  const out = lines.map((line, i) => {
    if (!timed[i]) return null;
    const { spans, placed } = timed[i];
    // (a line's last word ends by the next line's first, wherever that was found)
    let until = line.next;
    for (let k = i + 1; k < lines.length; k++) if (timed[k]) { until = timed[k].placed[timed[k].spans[0].first].first * SECONDS_PER_FRAME; break; }
    const words = new Array(line.words.length).fill(null);
    spans.forEach((s, k) => {
      const start = placed[s.first].first * SECONDS_PER_FRAME, later = spans[k + 1], limit = later ? placed[later.first].first * SECONDS_PER_FRAME : Math.max(start + 0.08, until);
      const stop = Math.min(limit, stops(start + 0.08, limit));
      words[s.word] = { time: start, end: Math.max(start + 0.08, stop), sung: (placed[s.last].last + 1) * SECONDS_PER_FRAME };
    });
    // (punctuation of its own: over at once, at the word before it, or the first after it)
    let last = null;
    for (let i2 = 0; i2 < words.length; i2++) { if (words[i2]) last = words[i2]; else if (last) words[i2] = { time: last.end, end: last.end }; }
    for (let i2 = words.length - 1; i2 >= 0; i2--) { if (words[i2]) last = words[i2]; else words[i2] = { time: last.time, end: last.time }; }
    return words;
  });
  onProgress(1);
  return out;
}
module.exports = { fitWords, SONG_RATE, SPLEETER };
