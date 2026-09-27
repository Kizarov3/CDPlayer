'use strict';
/** Folder and file names for a ripped CD — safe on macOS, Linux and Windows alike. */
const path = require('path');

const MAX = 120;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Text as a single file or folder name: unsafe characters → "_", no trailing dots or spaces, never empty. */
function safeName(text) {
  let s = String(text == null ? '' : text).replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_').slice(0, MAX).replace(/[. ]+$/, '');
  if (!s.trim()) s = '_';
  if (RESERVED.test(s)) s = `_${s}`;
  return s;
}

/** <music folder>/<Album Artist>/<Album> (<Year>) — or Unknown Artist/Audio CD (<disc ID>) for an unnamed disc. */
function albumFolder(musicFolder, { albumArtist, album, year, discId }) {
  if (!album) return path.join(musicFolder, 'Unknown Artist', `Audio CD (${String(discId || '').slice(0, 8)})`);
  return path.join(musicFolder, safeName(albumArtist || 'Unknown Artist'), safeName(year ? `${album} (${year})` : album));
}

/** "01 Title.flac" per track ("2-05 …" on a double album), made unique. */
function trackFiles(tracks) {
  const used = new Set();
  return tracks.map((t) => {
    const no = `${t.discs > 1 && t.disc ? `${t.disc}-` : ''}${String(t.number).padStart(2, '0')}`;
    const base = `${no} ${safeName(t.title || `Track ${t.number}`)}`;
    let name = `${base}.flac`;
    for (let k = 2; used.has(name.toLowerCase()); k++) name = `${base} (${k}).flac`;
    used.add(name.toLowerCase());
    return name;
  });
}

module.exports = { safeName, albumFolder, trackFiles };
