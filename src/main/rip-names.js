'use strict';
/** Folder and file names for a ripped CD — safe on macOS, Linux and Windows alike. */
const path = require('path');

const MAX_BYTES = 150; // well under the 255-byte name limit of APFS and ext4, with room for temp-file names
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Text as a single file or folder name: unsafe characters → "_", no trailing dots or spaces, never empty. */
function safeName(text) {
  let s = '';
  for (const ch of String(text == null ? '' : text).replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_')) { // whole characters, emoji included
    if (Buffer.byteLength(s + ch) > MAX_BYTES) break;
    s += ch;
  }
  s = s.replace(/[. ]+$/, '');
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
