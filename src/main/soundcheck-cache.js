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
