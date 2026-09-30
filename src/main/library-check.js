'use strict';
/**
 * The shelf's LIBRARY CHECK: what's wrong in the music folder, from the tags the shelf has already read — songs with
 * no tags, the same song in two files, albums missing track numbers, files that can't be played. (Albums with no
 * cover are found separately: that needs looking at the files.) Nothing here changes anything.
 */
const path = require('path');
const { sameName } = require('./same-name');

const SAME_LENGTH_S = 2; // two files of one song are within this of each other's length

/** tracks: [{ path, info }] (the shelf's) → { untagged: [path], duplicates: [[path]], gaps: [{ album, artist, disc, missing, folder }], unreadable: [path] }. */
function libraryIssues(tracks) {
  const unreadable = [], untagged = [], songs = new Map(), albums = new Map();
  for (const { path: p, info } of tracks) {
    if (!info.duration) { unreadable.push(p); continue; } // read no audio: can't be played
    if (!info.artist || !info.album) untagged.push(p);
    if (info.artist && info.title) {
      const key = `${sameName(info.artist)}\n${sameName(info.title)}`;
      if (!songs.has(key)) songs.set(key, []);
      songs.get(key).push({ p, duration: info.duration });
    }
    if (info.album && info.track) {
      const artist = info.albumArtist || info.artist || '';
      const key = `${sameName(artist)}\n${sameName(info.album)}\n${info.disc || 1}`;
      if (!albums.has(key)) albums.set(key, { album: info.album, artist, disc: info.disc || 1, folder: path.dirname(p), numbers: new Set() });
      albums.get(key).numbers.add(info.track);
    }
  }
  // Copies of one song: the same artist and title, and nearly the same length (not a live take or a remix).
  const duplicates = [];
  for (const copies of songs.values()) {
    const left = [...copies];
    while (left.length > 1) {
      const first = left.shift(), same = left.filter((c) => Math.abs(c.duration - first.duration) <= SAME_LENGTH_S);
      if (same.length) duplicates.push([first.p, ...same.map((c) => c.p)]);
      for (const c of same) left.splice(left.indexOf(c), 1);
    }
  }
  const gaps = [];
  for (const a of albums.values()) {
    const max = Math.max(...a.numbers), missing = [];
    for (let n = 1; n <= max; n++) if (!a.numbers.has(n)) missing.push(n);
    // A few songs of an album are yours on purpose; a hole or two in an otherwise whole one is what got lost.
    const lost = missing.length && (missing.length <= 2 || missing.length <= max / 4);
    if (lost && a.numbers.size > 1) gaps.push({ album: a.album, artist: a.artist, disc: a.disc, missing, folder: a.folder });
  }
  return { untagged, duplicates, gaps, unreadable };
}

module.exports = { libraryIssues };
