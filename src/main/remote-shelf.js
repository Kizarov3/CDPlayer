'use strict';
/**
 * The shelf as the phone sees it (phone remote): names, years, counts and dust times, never a file path.
 * An album's id on the shelf is built from its folder, so the phone gets a truncated SHA-1 of it instead;
 * main turns that key back into the album (with its paths) through byKey().
 */
const crypto = require('crypto');

const albumKey = (id) => crypto.createHash('sha1').update(String(id)).digest('hex').slice(0, 16);

// The shelf's albums → the phone's list. `colors` is shelf-colors.json: { [albumId]: { spine: [r,g,b], ... } }.
function phoneAlbums(albums, colors) {
  const cache = colors || {};
  return albums.map((a) => {
    const c = cache[a.id];
    return {
      id: albumKey(a.id), title: a.title, artist: a.artist, year: a.year, n: a.tracks.length,
      added: a.added, plays: a.plays, touched: a.touched, wrapped: a.wrapped,
      color: c && Array.isArray(c.spine) ? c.spine : null,
    };
  });
}

// One album's page on the phone: its songs by name, without where they live.
function phoneAlbum(album) {
  return {
    id: albumKey(album.id), title: album.title, artist: album.artist, year: album.year,
    tracks: album.tracks.map((t) => ({ title: t.title, duration: t.duration, disc: t.disc, track: t.track })),
  };
}

const byKey = (albums) => new Map(albums.map((a) => [albumKey(a.id), a]));

module.exports = { albumKey, phoneAlbums, phoneAlbum, byKey };
