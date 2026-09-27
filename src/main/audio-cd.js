'use strict';
/**
 * Real audio CDs. macOS mounts an inserted audio CD as a folder of AIFF tracks ("1 Audio Track.aiff"…) with its table
 * of contents in a hidden .TOC.plist; GNOME's gvfs on Linux mounts it as WAV tracks ("Track 1.wav"…). Both play like any
 * other file. What the tracks are called comes from MusicBrainz: the table of contents gives the disc's MusicBrainz
 * disc ID, which names the release — how Apple Music and every ripper name a CD. (CD-TEXT, names stored on the disc
 * itself, can't be read without talking to the drive directly; few discs carry it anyway.) Windows only shows an audio
 * CD as .cda shortcuts with no audio behind them, so there the drive is read directly (win-cd.js), its tracks
 * cdda:// paths.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const winCd = require('./win-cd');

const LEAD_IN = 150; // sectors before track 1's address 0 (2 seconds): MusicBrainz offsets count from the very start

/**
 * The MusicBrainz disc ID for a table of contents: first and last track numbers, and the lead-out and each track's
 * start as absolute sector offsets (address + 150). https://musicbrainz.org/doc/Disc_ID_Calculation
 */
function discId({ first, last, leadout, offsets }) {
  const hex = (n, width) => n.toString(16).toUpperCase().padStart(width, '0');
  let text = hex(first, 2) + hex(last, 2) + hex(leadout, 8);
  for (let i = 0; i < 99; i++) text += hex(offsets[i] || 0, 8);
  return crypto.createHash('sha1').update(text, 'ascii').digest('base64').replace(/\+/g, '.').replace(/\//g, '_').replace(/=/g, '-');
}
/** The same table of contents as MusicBrainz's toc parameter: "first last leadout offset1 offset2 …". */
const tocParam = ({ first, last, leadout, offsets }) => [first, last, leadout, ...offsets].join('+');

// ---- macOS: .TOC.plist -----------------------------------------------------------------------------------------

// Just enough of Apple's XML property list format for the table of contents: dicts, arrays, integers, strings, booleans.
function parsePlist(xml) {
  const tokens = String(xml).replace(/<\?xml[^>]*>|<!DOCTYPE[^>]*>|<!--[\s\S]*?-->/g, '').match(/<[^>]+>|[^<]+/g) || [];
  let i = 0;
  const text = () => { let t = ''; while (i < tokens.length && !tokens[i].startsWith('<')) t += tokens[i++]; return t; };
  function value() {
    while (i < tokens.length && !tokens[i].startsWith('<')) i++; // whitespace between elements
    const tag = tokens[i++];
    if (!tag) return undefined;
    if (/^<(true|false)\s*\/>$/.test(tag)) return tag.includes('true');
    if (/\/>$/.test(tag)) return tag.startsWith('<dict') ? {} : tag.startsWith('<array') ? [] : '';
    const name = /^<(\w+)/.exec(tag)[1];
    if (name === 'plist') { const v = value(); i++; return v; }
    if (name === 'dict') {
      const out = {};
      for (;;) {
        while (i < tokens.length && !tokens[i].startsWith('<')) i++;
        if (tokens[i] === '</dict>') { i++; return out; }
        i++; // <key>
        const key = text().trim();
        i++; // </key>
        out[key] = value();
      }
    }
    if (name === 'array') {
      const out = [];
      for (;;) {
        while (i < tokens.length && !tokens[i].startsWith('<')) i++;
        if (tokens[i] === '</array>') { i++; return out; }
        out.push(value());
      }
    }
    const body = text();
    i++; // closing tag
    if (name === 'integer') return parseInt(body, 10);
    if (name === 'real') return parseFloat(body);
    return body.trim();
  }
  return value();
}

/** A table of contents from macOS's .TOC.plist: the audio tracks of the first session. → { first, last, leadout, offsets, tracks: [n…] } or null. */
function tocFromPlist(xml) {
  const plist = parsePlist(xml);
  const session = plist && Array.isArray(plist.Sessions) ? plist.Sessions[0] : null;
  if (!session || !Array.isArray(session['Track Array'])) return null;
  const audio = session['Track Array'].filter((t) => t && !t.Data && Number.isInteger(t.Point) && Number.isInteger(t['Start Block']));
  if (!audio.length || !Number.isInteger(session['Leadout Block'])) return null;
  audio.sort((a, b) => a.Point - b.Point);
  // An enhanced CD's data session comes after the audio: the audio ends 11400 sectors before it starts.
  const dataTrack = session['Track Array'].find((t) => t && t.Data && t.Point > audio[audio.length - 1].Point);
  const leadout = (dataTrack ? dataTrack['Start Block'] - 11400 : session['Leadout Block']) + LEAD_IN;
  return { first: audio[0].Point, last: audio[audio.length - 1].Point, leadout, offsets: audio.map((t) => t['Start Block'] + LEAD_IN), tracks: audio.map((t) => t.Point) };
}

// ---- Linux: gvfs cdda ------------------------------------------------------------------------------------------

/** A table of contents from the tracks' WAV data sizes (2352 bytes a sector), the first starting after the lead-in. */
function tocFromSectors(sectorCounts) {
  const offsets = [];
  let at = LEAD_IN;
  for (const n of sectorCounts) { offsets.push(at); at += n; }
  return { first: 1, last: sectorCounts.length, leadout: at, offsets, tracks: sectorCounts.map((_, i) => i + 1) };
}
async function wavSectors(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const head = Buffer.alloc(4096);
    const { bytesRead } = await fh.read(head, 0, head.length, 0);
    for (let p = 12; p + 8 <= bytesRead;) {
      const id = head.toString('ascii', p, p + 4), size = head.readUInt32LE(p + 4);
      if (id === 'data') return Math.round(size / 2352);
      p += 8 + size + (size & 1);
    }
    return Math.round(((await fh.stat()).size - 44) / 2352);
  } finally { await fh.close(); }
}

// ---- Finding inserted discs --------------------------------------------------------------------------------------

const trackNumber = (name) => { const m = /(\d+)/.exec(name); return m ? parseInt(m[1], 10) : 0; };

// macOS: the mount points of audio CDs, which `mount` lists with the cddafs filesystem. Only these are ever looked
// inside — reading other removable drives would have macOS ask the user for permission for no reason.
const cddaMounts = (mountOutput) => String(mountOutput).split('\n').map((l) => /^\S+ on (.+) \(cddafs[,)]/.exec(l)).filter(Boolean).map((m) => m[1]);
function macCdMounts() {
  return new Promise((resolve) => execFile('/sbin/mount', (err, out) => resolve(err ? [] : cddaMounts(out))));
}
// The candidate mount points right now. CDPLAYER_CD_ROOT stands in for /Volumes (tests, and trying it without a drive).
async function candidateMounts() {
  const inDir = async (dir, kind, test = () => true) => {
    try { return (await fsp.readdir(dir)).filter(test).map((name) => ({ kind, mount: path.join(dir, name), name })); } catch { return []; }
  };
  if (process.env.CDPLAYER_CD_ROOT) return inDir(process.env.CDPLAYER_CD_ROOT, 'mac');
  if (process.platform === 'darwin') return (await macCdMounts()).map((mount) => ({ kind: 'mac', mount, name: path.basename(mount) }));
  if (process.platform === 'linux' && process.getuid) return inDir(`/run/user/${process.getuid()}/gvfs`, 'gvfs', (n) => /^cdda:/.test(n));
  return [];
}

// One disc, from its mount point: its tracks in order and its table of contents. → disc or null (not an audio CD, or
// one still being mounted).
async function readDisc({ kind, mount, name }) {
  try {
    if (kind === 'mac') {
      const xml = await fsp.readFile(path.join(mount, '.TOC.plist'), 'utf8').catch(() => null);
      const toc = xml && tocFromPlist(xml);
      if (!toc) return null;
      const files = (await fsp.readdir(mount)).filter((f) => /\.aiff?$/i.test(f) && !f.startsWith('.'));
      const byNumber = new Map(files.map((f) => [trackNumber(f), path.join(mount, f)]));
      const tracks = toc.tracks.map((n) => byNumber.get(n)).filter(Boolean);
      return tracks.length ? { mount, name, tracks, toc, id: discId(toc) } : null;
    }
    const files = (await fsp.readdir(mount)).filter((f) => /\.wav$/i.test(f)).sort((a, b) => trackNumber(a) - trackNumber(b));
    if (!files.length) return null;
    const tracks = files.map((f) => path.join(mount, f));
    const toc = tocFromSectors(await Promise.all(tracks.map(wavSectors)));
    return { mount, name: 'Audio CD', tracks, toc, id: discId(toc) };
  } catch { return null; }
}

// Windows: the discs in the drives, read through the CD helper — their tracks are cdda://F/1… paths. A drive whose
// disc is gone is forgotten, so its tracks stop playing. Only an answer that leaves a drive out means its disc is
// gone: a check that fails (the helper busy with a slow read, or restarting) keeps the discs as they were.
let winDiscs = []; // what the last check found
async function findWinDiscs() {
  let drives;
  try { drives = await winCd.drives(); } catch { return winDiscs; }
  const discs = [], seen = new Set();
  for (const drive of drives) {
    let toc = null;
    try { toc = await winCd.readToc(drive); } catch {
      const was = winDiscs.find((d) => d.mount === drive); // unreadable for a moment: still the same disc
      if (was) { discs.push(was); seen.add(drive); }
      continue;
    }
    if (!toc) continue;
    seen.add(drive);
    winCd.remember(drive, toc);
    const id = discId(toc), was = winDiscs.find((d) => d.mount === drive && d.id === id);
    discs.push(was || { mount: drive, name: 'Audio CD', tracks: toc.tracks.map((n) => winCd.trackPath(drive, n)), toc, id });
  }
  winCd.keepOnly(seen);
  winDiscs = discs;
  return discs;
}

// A disc is read once, when it turns up; after that it's only checked for still being there.
const known = new Map(); // mount -> disc
/** Every audio CD in a drive right now: [{ mount, name, tracks: [paths in order], toc, id }]. */
async function findDiscs() {
  if (process.platform === 'win32') return findWinDiscs();
  const candidates = await candidateMounts();
  for (const mount of known.keys()) if (!candidates.some((c) => c.mount === mount)) known.delete(mount);
  const discs = [];
  for (const candidate of candidates) {
    if (!known.has(candidate.mount)) { const disc = await readDisc(candidate); if (disc) known.set(candidate.mount, disc); }
    if (known.has(candidate.mount)) discs.push(known.get(candidate.mount));
  }
  return discs;
}

// ---- Names for the tracks ---------------------------------------------------------------------------------------

// What each track of a named disc is called, for metadata.getDetails: path -> { title, artist, album, year, track, of, cover }.
const names = new Map();
const detailsFor = (p) => names.get(p) || null;

/** The release a disc is, from MusicBrainz's answer to its disc ID (or its fuzzy table-of-contents match). */
function releaseFor(disc, answer) {
  const releases = (answer && answer.releases) || [];
  const hasDisc = (r) => (r.media || []).some((m) => (m.discs || []).some((d) => d.id === disc.id));
  const release = releases.find(hasDisc) || releases.find((r) => (r.media || []).some((m) => (m.tracks || []).length === disc.tracks.length)) || releases[0];
  if (!release) return null;
  const medium = (release.media || []).find((m) => (m.discs || []).some((d) => d.id === disc.id))
    || (release.media || []).find((m) => (m.tracks || []).length === disc.tracks.length) || (release.media || [])[0];
  return { release, medium };
}

const credit = (c) => (c || []).map((x) => `${x.name}${x.joinphrase || ''}`).join('').trim() || null;

/**
 * Names the disc's tracks from MusicBrainz (via `fetchMb(pathAndQuery)`, and `fetchCover(releaseId)` for its cover).
 * → { album, artist, year } once named, or null when MusicBrainz doesn't know the disc (the tracks keep their file
 * names, "1 Audio Track").
 */
async function nameDisc(disc, { fetchMb, fetchCover, isCurrent = () => true }) {
  const answer = await fetchMb(`discid/${encodeURIComponent(disc.id)}?toc=${tocParam(disc.toc)}&inc=artist-credits+recordings&fmt=json`);
  const found = releaseFor(disc, answer);
  if (!found || !found.medium) return null;
  const { release, medium } = found;
  const album = release.title, albumArtist = credit(release['artist-credit']);
  const year = /\d{4}/.exec(release.date || '');
  const cover = await fetchCover(release.id).catch(() => null);
  const tracks = medium.tracks || [];
  // (A disc swapped out while it was looked up names nothing: on Windows the next disc's tracks have the same paths.)
  if (!isCurrent()) return null;
  disc.tracks.forEach((p, i) => {
    const t = tracks[i] || {};
    names.set(p, {
      title: t.title || (t.recording && t.recording.title) || `Track ${i + 1}`,
      artist: credit(t['artist-credit'] || (t.recording && t.recording['artist-credit'])) || albumArtist,
      album, albumArtist, year: year ? year[0] : null, track: i + 1, of: disc.tracks.length,
      disc: (release.media || []).length > 1 ? medium.position : null, cover,
    });
  });
  return { album, artist: albumArtist, year: year ? year[0] : null };
}
function forgetDisc(disc) { for (const p of disc.tracks) names.delete(p); }

module.exports = { cddaMounts, discId, tocParam, parsePlist, tocFromPlist, tocFromSectors, findDiscs, nameDisc, forgetDisc, detailsFor, releaseFor };
