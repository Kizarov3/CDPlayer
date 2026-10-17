'use strict';
/**
 * Hidden tracks found in files (hidden-track.js in the renderer), kept in hidden.json in the data folder so a file is
 * looked through once: { version, tracks: { [file]: { stamp, songEnd, hiddenStart, name, asked, found } | { stamp,
 * none: true } } }. `stamp` is the file's "size:mtime", as in soundcheck.json — a changed file is looked at again.
 * get → the entry, null (looked at: nothing there) or undefined (not looked at, or changed since).
 */
const VERSION = 1;

function createHiddenCache({ read, write, stat, delayMs = 1000 }) {
  let tracks = null, timer = null;
  const load = () => {
    if (tracks) return tracks;
    try { const j = JSON.parse(read() || ''); tracks = j && j.version === VERSION && j.tracks && typeof j.tracks === 'object' ? j.tracks : {}; } catch { tracks = {}; }
    return tracks;
  };
  const stampOf = (file) => { const st = stat(file); return st ? `${st.size}:${Math.round(st.mtimeMs)}` : null; };
  const saveSoon = () => { clearTimeout(timer); timer = setTimeout(() => { timer = null; write(JSON.stringify({ version: VERSION, tracks })); }, delayMs); };
  const entryOf = (e) => ({ songEnd: e.songEnd, hiddenStart: e.hiddenStart, name: e.name ?? null, asked: !!e.asked, found: !!e.found });
  const current = (file) => { const e = load()[file]; return e && e.stamp === stampOf(file) ? e : null; };
  return {
    get(file) {
      const e = current(file);
      return !e ? undefined : e.none ? null : entryOf(e);
    },
    put(file, entry) {
      const stamp = stampOf(file);
      if (!stamp) return;
      load()[file] = entry ? { stamp, ...entryOf(entry) } : { stamp, none: true };
      saveSoon();
    },
    update(file, fields) {
      const e = current(file);
      if (!e || e.none) return;
      load()[file] = { stamp: e.stamp, ...entryOf({ ...e, ...fields }) };
      saveSoon();
    },
  };
}

module.exports = { createHiddenCache };
