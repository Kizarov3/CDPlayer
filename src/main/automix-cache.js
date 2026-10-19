'use strict';
/**
 * AUTOMIX's measurements (automix.js edges in the renderer), kept in automix.json in the data folder so a song is
 * measured once: { version, tracks: { [file]: { stamp, start, end, fadeStart, settle, gapEnd, introRise, endLevel, headLevel, duration } } }. `stamp` is
 * the file's "size:mtime", as in Sound Check's cache — a changed file is measured again. A song found silent is kept as
 * { stamp, silent: true }, so it isn't decoded again for nothing.
 */
const VERSION = 3; // 2: settle, endLevel, headLevel; 3: settle at -24 dB, gapEnd (older entries are measured again)
const FIELDS = ['start', 'end', 'fadeStart', 'settle', 'gapEnd', 'introRise', 'endLevel', 'headLevel', 'duration'];

function createAutomixCache({ read, write, stat, delayMs = 1000 }) {
  let tracks = null, timer = null;
  const load = () => {
    if (tracks) return tracks;
    try { const j = JSON.parse(read() || ''); tracks = j && j.version === VERSION && j.tracks && typeof j.tracks === 'object' ? j.tracks : {}; } catch { tracks = {}; }
    return tracks;
  };
  const stampOf = (file) => { const st = stat(file); return st ? `${st.size}:${Math.round(st.mtimeMs)}` : null; };
  const save = () => { timer = null; write(JSON.stringify({ version: VERSION, tracks })); };
  return {
    /** → { [file]: edges, or null for a silent song } for the files known and unchanged. */
    get(files) {
      const all = load(), out = {};
      for (const f of files) {
        const e = all[f];
        if (!e || e.stamp !== stampOf(f)) continue;
        out[f] = e.silent ? null : Object.fromEntries(FIELDS.map((k) => [k, e[k]]));
      }
      return out;
    },
    put(file, edges) {
      const stamp = stampOf(file);
      if (!stamp) return;
      const ok = edges && FIELDS.every((k) => Number.isFinite(edges[k]));
      load()[file] = ok ? { stamp, ...Object.fromEntries(FIELDS.map((k) => [k, Math.round(edges[k] * 1000) / 1000])) } : { stamp, silent: true };
      clearTimeout(timer); timer = setTimeout(save, delayMs);
    },
  };
}

module.exports = { createAutomixCache };
