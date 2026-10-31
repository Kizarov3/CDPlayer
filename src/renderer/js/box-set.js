// Box sets and double albums: an album of two discs stands on the shelf in a fat double jewel case, one of three or
// more in a cardboard slipcase box; its case and booklet list its songs disc by disc; in the changer its discs go into
// slots side by side; and as one disc ends and the next begins, the deck changes discs (deck-display.js, disc.js).
// Pure: no DOM. A shelf album's tracks carry their disc (main's shelf.js: 1 when nothing says otherwise).
import { sameName } from './shelf-missing.js';

/** The case an album of `discs` discs stands in on the shelf: '' (a jewel case), 'double' or 'box'. */
export const caseKind = (discs) => (discs >= 3 ? 'box' : discs === 2 ? 'double' : '');

/** The discs of an album's tracks (in disc and track order, as the shelf has them) → [{ no, tracks }], disc by disc. */
export function discRuns(tracks, discOf = (tr) => tr.disc) {
  const runs = [];
  for (const tr of tracks) {
    const no = Number(discOf(tr)) || 1, last = runs[runs.length - 1];
    if (last && last.no === no) last.tracks.push(tr);
    else runs.push({ no, tracks: [tr] });
  }
  return runs;
}

/**
 * A tracklist's rows with a { disc: n } heading before each disc's first one — only for an album of more than one
 * disc (one disc's list stays as it was). `discOf(row)` → its disc, or null when it doesn't say (a song you don't have,
 * from MusicBrainz' list): then it's on the disc of the row before it (the first: of the first that says).
 */
export function withDiscHeads(rows, discOf = (r) => r.disc) {
  const said = rows.map((r) => Number(discOf(r)) || null);
  const first = said.find(Boolean) || 1;
  let at = null;
  const discs = said.map((d) => (at = d || at || first));
  if (new Set(discs).size < 2) return rows.slice();
  const out = [];
  rows.forEach((r, k) => { if (k === 0 || discs[k] !== discs[k - 1]) out.push({ disc: discs[k] }); out.push(r); });
  return out;
}

/**
 * The disc the deck changes to between two songs (each { album, artist: its album artist or artist, disc: number or
 * null }): the next song's disc when it's another disc of the same album, else 0 — another album, or a song that
 * doesn't say which disc it's on, is no change of disc.
 */
export function discChange(before, after) {
  if (!before || !after || !before.album || !after.album || !before.disc || !after.disc) return 0;
  if (sameName(before.album) !== sameName(after.album) || sameName(before.artist) !== sameName(after.artist)) return 0;
  return before.disc !== after.disc ? after.disc : 0;
}

/** A song's details ({ album, artist, credits }) as discChange takes them. */
export const discOfDetails = (d) => (d ? {
  album: d.album || null, artist: (d.credits && d.credits.albumArtist) || d.artist || null,
  disc: (d.credits && d.credits.disc && Number(d.credits.disc.no)) || null,
} : null);
