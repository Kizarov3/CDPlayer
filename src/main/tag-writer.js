'use strict';
/**
 * Writing tags, covers and lyrics into audio files (node-taglib-sharp, LGPL-2.1: MP3, M4A, FLAC, OGG/Opus, WAV, AIFF).
 * A file is never edited in place: the change is made to a copy beside it, the copy is read back to make sure it's
 * still a playable file with the new tags, and only then does it replace the original — so a failure part-way, or a
 * format the library gets wrong, leaves the original untouched.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { t } = require('./i18n');

// The tag library is loaded the first time a tag is read or written, not at startup: it's large (a twentieth of a second
// and 15 MB to load), and most sessions never save a tag.
let lib = null;
function taglib() {
  if (lib) return lib;
  lib = require('node-taglib-sharp');
  // ID3v2.3 for MP3 and AIFF: what every player and tag reader understands. Older files' v2.2 tags are brought up to
  // it (their lyrics frame is one other readers, and CDPlayer's, don't know). A WAV's ID3 chunk has to be v2.4: taglib
  // gives it a footer, which only v2.4 has. Text in UTF-16, which both versions have, for any language.
  lib.Id3v2Settings.defaultEncoding = lib.StringType.UTF16;
  return lib;
}
function open(filePath) {
  const { File, Id3v2Settings } = taglib();
  const riff = /\.wave?$/i.test(filePath);
  Id3v2Settings.defaultVersion = riff ? 4 : 3;
  Id3v2Settings.forceDefaultVersion = !riff;
  return File.createFromPath(filePath);
}

// The fields the Tags panel and MusicBrainz deal in, and how each maps onto taglib's tag.
const FIELDS = {
  title: { get: (t) => t.title, set: (t, v) => { t.title = v; } },
  artist: { get: (t) => (t.performers || []).join('; '), set: (t, v) => { t.performers = v ? [v] : []; } },
  album: { get: (t) => t.album, set: (t, v) => { t.album = v; } },
  albumArtist: { get: (t) => (t.albumArtists || []).join('; '), set: (t, v) => { t.albumArtists = v ? [v] : []; } },
  year: { get: (t) => t.year || null, set: (t, v) => { t.year = v ? parseInt(v, 10) || 0 : 0; } },
  track: { get: (t) => t.track || null, set: (t, v) => { t.track = v ? parseInt(v, 10) || 0 : 0; } },
  trackCount: { get: (t) => t.trackCount || null, set: (t, v) => { t.trackCount = v ? parseInt(v, 10) || 0 : 0; } },
  disc: { get: (t) => t.disc || null, set: (t, v) => { t.disc = v ? parseInt(v, 10) || 0 : 0; } },
  discCount: { get: (t) => t.discCount || null, set: (t, v) => { t.discCount = v ? parseInt(v, 10) || 0 : 0; } },
  genre: { get: (t) => (t.genres || []).join('; '), set: (t, v) => { t.genres = v ? [v] : []; } },
  label: { get: (t) => t.publisher, set: (t, v) => { t.publisher = v; } },
  lyrics: { get: (t) => t.lyrics, set: (t, v) => { t.lyrics = v; } },
  musicBrainzTrackId: { get: (t) => t.musicBrainzTrackId, set: (t, v) => { t.musicBrainzTrackId = v; } },
  musicBrainzReleaseId: { get: (t) => t.musicBrainzReleaseId, set: (t, v) => { t.musicBrainzReleaseId = v; } },
};
const WRITABLE = new Set(['.mp3', '.m4a', '.mp4', '.aac', '.flac', '.ogg', '.oga', '.opus', '.wav', '.wave', '.aif', '.aiff', '.aifc']);
const canWrite = (p) => typeof p === 'string' && !/\.cue#\d+$/i.test(p) && WRITABLE.has(path.extname(p).toLowerCase());

/** What the file's tags say now, in the Tags panel's terms (plus whether it has a cover). */
function readTags(filePath) {
  const f = open(filePath);
  try {
    const out = {};
    for (const [k, { get }] of Object.entries(FIELDS)) { const v = get(f.tag); out[k] = v === undefined || v === '' ? null : v; }
    out.hasCover = (f.tag.pictures || []).length > 0;
    return out;
  } finally { f.dispose(); }
}

function coverPicture(cover) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(cover);
  const bytes = m ? Buffer.from(m[2], 'base64') : Buffer.from(cover);
  const { Picture, PictureType, ByteVector } = taglib();
  const pic = Picture.fromData(ByteVector.fromByteArray(bytes));
  pic.type = PictureType.FrontCover;
  pic.mimeType = m ? m[1] : 'image/jpeg';
  pic.description = 'Cover';
  return pic;
}

/**
 * Writes `changes` ({ field: value }, value null to clear; `cover`: a data URL or image bytes to become the front
 * cover) into the file. → { ok: true } or { ok: false, error }.
 */
async function writeTags(filePath, changes) {
  if (!canWrite(filePath)) return { ok: false, error: t('CAN’T WRITE TAGS TO THIS FILE') };
  const dir = path.dirname(filePath), ext = path.extname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath, ext)}.cdplayer-${process.pid}-${Date.now()}${ext}`);
  try {
    await fsp.copyFile(filePath, tmp);
    const f = open(tmp);
    try {
      for (const [k, v] of Object.entries(changes)) {
        if (k === 'cover') { if (v) f.tag.pictures = [coverPicture(v), ...(f.tag.pictures || []).filter((p) => p.type !== taglib().PictureType.FrontCover)]; continue; }
        if (FIELDS[k]) FIELDS[k].set(f.tag, v === '' ? null : v);
      }
      f.save();
    } finally { f.dispose(); }
    await verify(filePath, tmp, changes);
    await replace(tmp, filePath);
    return { ok: true };
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    return { ok: false, error: String((e && e.message) || e).toUpperCase().slice(0, 120) };
  }
}

// The edited copy must still be the same audio (same length, same format) and carry the new title.
async function verify(original, edited, changes) {
  const { parseFile } = await import('music-metadata');
  const [a, b] = await Promise.all([parseFile(original, { duration: true, skipCovers: true }), parseFile(edited, { duration: true, skipCovers: true })]);
  if (!b.format.duration || Math.abs((a.format.duration || 0) - b.format.duration) > 0.5) throw new Error('the edited file didn’t play the same');
  if (a.format.codec !== b.format.codec) throw new Error('the edited file changed format');
  if (changes.title && b.common.title !== changes.title) throw new Error('the new tags didn’t read back');
}

// Rename over the original. Windows can refuse for a moment while something else has the file open: retry briefly.
async function replace(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { await fsp.rename(from, to); return; } catch (e) {
      if (attempt >= 5 || !/EPERM|EBUSY|EACCES/.test(e.code || '')) throw e;
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
}

module.exports = { readTags, writeTags, canWrite, FIELDS };
