'use strict';
/**
 * The music folder, watched (recursively) so the CD shelf keeps up with it by itself: an album ripped, copied in,
 * retagged or deleted. Only names that can change the shelf count — audio, cue sheets, covers; never hidden files,
 * which are also what the rip and the tag writer write before their final rename. A burst of changes is one, once the
 * folder has been quiet for `quietMs`. Watching that isn't possible (a network drive, Linux out of inotify watches)
 * just stops: the shelf still reads the folder each time it's opened.
 */
const fs = require('fs');
const path = require('path');
const { isSupportedAudio } = require('./library');
const { COVER_FILE } = require('./shelf');

function relevant(filename) {
  if (filename === null || filename === undefined) return true; // some systems don't say what changed
  const name = path.basename(String(filename));
  if (name.startsWith('.')) return false;
  return isSupportedAudio(name) || /\.cue$/i.test(name) || COVER_FILE.test(name);
}

function createLibraryWatch({ watch = fs.watch, quietMs = 3000, onChange, timers = { setTimeout, clearTimeout } }) {
  let watcher = null, folder = null, timer = null;
  function stop() {
    if (timer) { timers.clearTimeout(timer); timer = null; }
    if (watcher) { try { watcher.close(); } catch { /* already closed */ } watcher = null; }
    folder = null;
  }
  function start(dir) {
    if (dir && dir === folder && watcher) return;
    stop();
    if (!dir) return;
    try {
      watcher = watch(dir, { recursive: true }, (_event, filename) => {
        if (!relevant(filename && filename.toString())) return;
        if (timer) timers.clearTimeout(timer);
        timer = timers.setTimeout(() => { timer = null; onChange(); }, quietMs);
      });
      folder = dir;
      watcher.on('error', () => stop());
    } catch { stop(); }
  }
  return { start, stop, get folder() { return folder; } };
}

module.exports = { createLibraryWatch, relevant };
