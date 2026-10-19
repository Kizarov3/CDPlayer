'use strict';
/**
 * The music folders, each watched (recursively) so the CD shelf keeps up with it by itself: an album ripped, copied in,
 * retagged or deleted. Only names that can change the shelf count — audio, cue sheets, covers; never hidden files,
 * which are also what the rip and the tag writer write before their final rename. A burst of changes is one, once the
 * folders have been quiet for `quietMs`. Watching that isn't possible (a network drive, Linux out of inotify watches,
 * a drive unplugged) just stops for that folder: the shelf still reads it each time it's opened.
 */
const fs = require('fs');
const path = require('path');
const { isSupportedAudio } = require('./library');
const { COVER_FILE } = require('./shelf');

function relevant(filename) {
  if (filename === null || filename === undefined) return true; // some systems don't say what changed
  const name = path.basename(String(filename));
  if (name.startsWith('.')) return false;
  // A folder moved in or out (dragged in, put in the Trash) comes as one change named after the folder alone: a name
  // without a file's extension ("OK Computer", "Vol. 2") counts too.
  const ext = path.extname(name);
  if (!ext || !/^\.[a-z0-9]{1,5}$/i.test(ext)) return true;
  return isSupportedAudio(name) || /\.cue$/i.test(name) || COVER_FILE.test(name);
}

function createLibraryWatch({ watch = fs.watch, quietMs = 3000, onChange, timers = { setTimeout, clearTimeout } }) {
  const watchers = new Map(); // folder → its watcher
  let timer = null;
  const close = (w) => { try { w.close(); } catch { /* already closed */ } };
  function stop() {
    if (timer) { timers.clearTimeout(timer); timer = null; }
    for (const w of watchers.values()) close(w);
    watchers.clear();
  }
  /** Watches `dirs` (one folder, or a list), and only them; the same ones again keep their watches. */
  function start(dirs) {
    const wanted = [].concat(dirs || []).filter(Boolean);
    for (const [dir, w] of watchers) if (!wanted.includes(dir)) { close(w); watchers.delete(dir); }
    if (!wanted.length) { stop(); return; }
    for (const dir of wanted) {
      if (watchers.has(dir)) continue;
      try {
        const w = watch(dir, { recursive: true }, (_event, filename) => {
          if (!relevant(filename && filename.toString())) return;
          if (timer) timers.clearTimeout(timer);
          timer = timers.setTimeout(() => { timer = null; onChange(); }, quietMs);
        });
        watchers.set(dir, w);
        w.on('error', () => { close(w); if (watchers.get(dir) === w) watchers.delete(dir); });
      } catch { /* not watchable: read when the shelf opens */ }
    }
  }
  // (the folders watched, as one: a single folder's own path; null for none)
  return { start, stop, get folder() { return watchers.size ? [...watchers.keys()].join('\n') : null; } };
}

module.exports = { createLibraryWatch, relevant };
